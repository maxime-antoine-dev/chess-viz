import { Visualization } from "./Visualization.js";
import { openingExplorerState } from "./OpeningExplorerState.js";
import { ChessboardWidget } from "./Chessboard.js";
import { OPENING_FIRST_MOVES } from "./openings.js";

class OpeningExplorerVisualization extends Visualization {
	constructor(data, container, chessboardContainer) {
		super(data, container, { top: 0, right: 0, bottom: 0, left: 0 });
		this.chessboardContainer = chessboardContainer;

		this._boardWidget = null;

		this.initialized = false;

		this._sun_vis = null;
		this._sun_radius = 0;

		this._sun_x = null;
		this._sun_y = null;
		this._sun_arc = null;
		this._sun_root = null;
		this._current_root = null;

		this.last_hovered_node = null;

		this._lastFocusedPgn = null;
		this._pgnUnsub = null;

		this._lastColorApplied = null;
	}

	#normKey(s) {
		return (s ?? "")
			.toString()
			.trim()
			.toLowerCase()
			.normalize("NFD")
			.replace(/[\u0300-\u036f]/g, "");
	}

	#setSelectValue(id, value) {
		const el = document.getElementById(id);
		if (!el) return;

		if (el.value === value) return;

		window.__suppressOpeningToPGN = true;
		el.value = value;
		el.dispatchEvent(new Event("change", { bubbles: true }));
		window.__suppressOpeningToPGN = false;
	}

	async init() {
		if (!this.initialized) {
			await this.loadData();
			this.measure();
			this.setupSVG();
			await this.initBoardWidget();
			this.initialized = true;
		}
		return this;
	}

	render(time_control, elo, color, opening) {
		this.filters.time_control = time_control;
		this.filters.elo = elo;
		this.filters.color = Number.parseInt(color);
		this.filters.opening = opening;

		this.init()
			.then(async () => {
				// keep board orientation synced with color
				if (this._lastColorApplied !== color) {
					this._lastColorApplied = color;
					const ori = String(color) === "2" ? "black" : "white";
					this._boardWidget?.setOrientation(ori);
				}

				await this.initSunburst();

				// after rebuild, focus on current PGN if we have a move-tree
				if (this.filters.opening !== "All") {
					const pgnNow = (openingExplorerState.getPGN?.() ?? "").trim();
					this._lastFocusedPgn = pgnNow;
					this.#focusSunburstFromPgn(pgnNow, 0);
				}
			})
			.catch((err) => console.error("Render error:", err));
	}

	#findTreeRootAndFocusFromOpening(rawData, openingName) {
		const pgn = (OPENING_FIRST_MOVES?.[openingName] ?? "").trim();
		if (!pgn) return null;

		const moves = this.#tokenizeMovetextToSans(pgn);
		if (!moves.length) return null;

		let currentList = rawData;
		let rootNode = null;

		// We record only the portion that actually exists in the dataset
		const matchedMoves = [];

		for (const mv of moves) {
			if (!Array.isArray(currentList) || currentList.length === 0) break;

			const found = currentList.find((n) => n?.move === mv);
			if (!found) break;

			if (!rootNode) rootNode = found;
			matchedMoves.push(mv);

			currentList = found.children ?? [];
		}

		if (!rootNode) return null;

		// Focus inside the sunburst: since rootNode is rendered as the first child,
		// we must NOT include its own move in the focus sequence.
		const focusMoves = matchedMoves.slice(1).join(" ");

		return { rootNode, focusMoves, openingPgn: pgn };
	}

	async initSunburst() {
		const chartEl = this.container;
		if (!chartEl || !this.data) return;

		d3.select(chartEl).selectAll("*").remove();

		this._sun_radius = Math.min(this.width, this.height) / 2;

		this._sun_vis = d3
			.select(chartEl)
			.append("svg")
			.attr("viewBox", `0 0 ${this.width} ${this.height}`)
			.append("g")
			.attr("transform", `translate(${this.width / 2},${this.height / 2})`);

		const tc = this.filters.time_control;
		const elo = this.filters.elo;
		const opening = this.filters.opening;

		this._center_label = this._sun_vis
			.append("text")
			.attr("text-anchor", "middle")
			.style("fill", "white")
			.style("pointer-events", "none");

		const rawData = this.data?.payload?.[tc]?.[elo];
		if (!rawData || !Array.isArray(rawData)) {
			this._sun_vis.append("text").attr("text-anchor", "middle").style("fill", "white").text("No data");
			return;
		}

		let hierarchyData = null;
		let focusMoves = "";

		if (opening && opening !== "All") {
			// ✅ NEW: openingName -> pgn -> traverse by node.move
			const traversal = this.#findTreeRootAndFocusFromOpening(rawData, opening);

			if (!traversal?.rootNode) {
				this._sun_vis
					.append("text")
					.attr("text-anchor", "middle")
					.style("fill", "white")
					.text(`Opening not found (by moves): ${opening}`);
				return;
			}

			focusMoves = traversal.focusMoves;

			hierarchyData = {
				name: opening, // keep label in the center
				variant: traversal.rootNode.variant || "Unknown",
				_isMove: false,
				children: [this._sun_recursiveTransform(traversal.rootNode)],
			};
		} else {
			hierarchyData = {
				name: "All Openings",
				variant: "Root",
				_isMove: false,
				children: rawData.map((v) => this._sun_recursiveTransform(v)),
			};
		}

		this._sun_createVisualization(hierarchyData, this._sun_radius);

		// ✅ NEW: after build, focus the node corresponding to the full opening PGN path
		// focusMoves is the move sequence inside the subtree (excluding the rootNode.move)
		if (opening && opening !== "All") {
			this._lastFocusedPgn = focusMoves;
			this.#focusSunburstFromPgn(focusMoves, 0);
		}
	}

	_sun_recursiveTransform(data) {
		const isMove = !!data.move;
		const node = {
			name: data.move || data.name || "Unknown",
			variant: data.variant || "Unknown",
			_isMove: isMove,
		};

		if (data.children && Array.isArray(data.children) && data.children.length > 0) {
			node.children = data.children.map((cv) => this._sun_recursiveTransform(cv));
		} else {
			node.size = data.count || 1;
		}

		if (data.count) node.value = data.count;
		return node;
	}

	#tokenizeMovetextToSans(raw) {
		let s = (raw ?? "").toString().replace(/\s+/g, " ").trim();
		if (!s) return [];

		const tokens = s.split(" ").map((x) => x.trim()).filter(Boolean);
		return tokens.filter((tok) => {
			if (/^\d+\.(\.\.)?$/.test(tok)) return false;
			if (/^\d+\.\.\.$/.test(tok)) return false;
			if (/^\d+\.$/.test(tok)) return false;
			if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(tok)) return false;
			return true;
		});
	}

	#findNodeForSansSequence(sans) {
		if (!this._sun_root) return null;
		if (!Array.isArray(sans) || sans.length === 0) return this._sun_root;

		let cur = this._sun_root;
		if (this.filters.opening && this.filters.opening !== "All") {
			cur = cur.children?.[0] ?? cur;
		}

		for (const san of sans) {
			const next = (cur.children || []).find((c) => c?.data?.name === san);
			if (!next) return null;
			cur = next;
		}

		return cur;
	}

	#applyZoomToNode(d, arc, radius, durationMs) {
		this._current_root = d;
		this._sun_vis
			.selectAll("path")
			.style("display", (node) => (node.ancestors().includes(d) ? null : node.style?.("display")));

		const transition = this._sun_vis.transition().duration(durationMs);

		const xd = d3.interpolate(this._sun_x.domain(), [d.x0, d.x1]);
		const yd = d3.interpolate(this._sun_y.domain(), [d.y0, 1]);
		const yr = d3.interpolate(this._sun_y.range(), [0, radius]);

		this._sun_vis
			.selectAll("path")
			.transition(transition)
			.attrTween("d", (node) => (t) => {
				this._sun_x.domain(xd(t));
				this._sun_y.domain(yd(t)).range(yr(t));
				return arc(node);
			});

		transition.on("end", () => {
			this._sun_vis
				.selectAll("path")
				.style("display", (node) => (node.ancestors().includes(d) ? null : "none"));
		});
	}

	#focusSunburstFromPgn(pgnMovetext, durationMs = 350) {
		if (!this._sun_vis || !this._sun_arc || !this._sun_root) return;

		if (!pgnMovetext || !pgnMovetext.trim()) {
			this.#applyZoomToNode(this._sun_root, this._sun_arc, this._sun_radius, durationMs);
			return;
		}

		const sans = this.#tokenizeMovetextToSans(pgnMovetext);
		const target = this.#findNodeForSansSequence(sans);
		if (!target) return;

		this.#applyZoomToNode(target, this._sun_arc, this._sun_radius, durationMs);
	}

	_sun_zoom(event, d, arc, radius) {
		event.stopPropagation();

		if (this._current_root === d && d.parent) {
			d = d.parent;
		}

		const moves = d
			.ancestors()
			.reverse()
			.slice(1)
			.filter((n) => n?.data?._isMove)
			.map((n) => n.data.name);

		// If user clicks back to (sub)root => reset board (PGN empty)
		if (moves.length === 0) {
			openingExplorerState.setPGN("", { source: "sunburst_zoom" });
			this.#setSelectValue("opening", "All");
		} else {
			openingExplorerState.setPGN(moves.join(" "), { source: "sunburst_zoom" });
		}

		this.#applyZoomToNode(d, arc, radius, 750);
	}

	_sun_createVisualization(json, radius) {
		this._sun_x = d3.scaleLinear().range([0, 2 * Math.PI]);
		this._sun_y = d3.scaleSqrt().range([0, radius]);

		const root = d3
			.hierarchy(json)
			.sum((d) => d.size || 0)
			.sort((a, b) => b.value - a.value);

		this._sun_root = root;
		this._current_root = root;

		d3.partition()(root);
		const nodes = root.descendants().filter((d) => d.depth && d.x1 - d.x0 > 0.001);

		const arc = d3
			.arc()
			.startAngle((d) => Math.max(0, Math.min(2 * Math.PI, this._sun_x(d.x0))))
			.endAngle((d) => Math.max(0, Math.min(2 * Math.PI, this._sun_x(d.x1))))
			.innerRadius((d) => Math.max(0, this._sun_y(d.y0)))
			.outerRadius((d) => Math.max(0, this._sun_y(d.y1)));

		this._sun_arc = arc;

		const colorScale = d3.scaleOrdinal(d3.quantize(d3.interpolateRainbow, root.children?.length + 1 || 2));
		this._sun_vis
			.selectAll("path")
			.data(nodes)
			.enter()
			.append("path")
			.attr("d", arc)
			.style("cursor", "pointer")
			.style("fill", (d) => colorScale(d.ancestors().reverse()[1]?.data.name))
			.style("stroke", "#0b1220")
			.style("display", (d) => (d.depth > 0 ? null : "none"))
			.on("click", (event, d) => this._sun_zoom(event, d, arc, radius))
			.on("mouseover", (event, d) => {
				const tooltip = document.getElementById("tooltip");
				if (tooltip) {
					tooltip.style.opacity = 1;
					tooltip.innerHTML = `<strong>${d.data.name}</strong><br>${d.data.variant}<br>Games: ${d.value}`;
				}
				if (this.last_hovered_node) this.last_hovered_node.style("opacity", 1);
				this.last_hovered_node = d3.select(event.currentTarget);
				this.last_hovered_node.style("opacity", 0.8);
			})
			.on("mousemove", (event) => {
				const tooltip = document.getElementById("tooltip");
				if (tooltip) {
					tooltip.style.left = event.pageX + 10 + "px";
					tooltip.style.top = event.pageY - 10 + "px";
				}
			})
			.on("mouseleave", () => {
				const tooltip = document.getElementById("tooltip");
				if (tooltip) tooltip.style.opacity = 0;
			});
	}

	// === Chessboard ===
	async initBoardWidget() {
		const boardEl = document.getElementById("oe-board");
		const btnReset = document.getElementById("oe-reset");
		const btnFlip = document.getElementById("oe-flip");

		if (!boardEl) return;

		this._boardWidget = new ChessboardWidget({ store: openingExplorerState });
		await this._boardWidget.mount({ boardEl });

		if (btnReset) {
			btnReset.addEventListener("click", () => {
				openingExplorerState.setPGN("", { source: "reset" });
				this.#setSelectValue("opening", "All");
			});
		}

		if (btnFlip) {
			btnFlip.addEventListener("click", () => {
				this._boardWidget.flip();

				const ori = this._boardWidget.getOrientation();
				const nextColor = ori === "black" ? "2" : "1";

				const colorSel = document.getElementById("color");
				if (colorSel && colorSel.value !== nextColor) {
					colorSel.value = nextColor;
					colorSel.dispatchEvent(new Event("change", { bubbles: true }));
				}
			});
		}
	}

	detectOpeningFromPgnPrefix(pgnMovetext) {
		const entries = Object.entries(OPENING_FIRST_MOVES || {})
			.filter(([k, v]) => k !== "All" && v)
			.sort((a, b) => b[1].length - a[1].length);

		for (const [name, prefix] of entries) {
			if ((pgnMovetext || "").startsWith(prefix)) return name;
		}
		return null;
	}
}

export { OpeningExplorerVisualization };
