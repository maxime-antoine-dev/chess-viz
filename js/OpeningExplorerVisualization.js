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
		this._winRateBar = null;
		this._sunRenderToken = 0;
		this._lastSunburstKey = null;
		this._subtreeRootSan = null;
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

	// "e4 e5 Nf3 Nf6 Bb5" => "1. e4 e5 2. Nf3 Nc6 3. Bb5"
	#formatSansMovesToNumberedPgn(moves) {
		const mv = Array.isArray(moves) ? moves.filter(Boolean) : [];
		if (mv.length === 0) return "";

		const out = [];
		for (let i = 0; i < mv.length; i += 2) {
			const moveNo = Math.floor(i / 2) + 1;
			out.push(`${moveNo}. ${mv[i]}`);
			if (mv[i + 1]) out.push(mv[i + 1]);
		}
		return out.join(" ");
	}

	async init() {
		if (!this.initialized) {
			await this.loadData();
			this.measure();
			this.setupSVG();
			await this.initBoardWidget();

			// Sunburst react to board moves : reset without rebuilding everything:
			if (!this._pgnUnsub) {
				this._pgnUnsub = openingExplorerState.onPGNChange(({ pgn }) => {
					if (!this._sun_vis || !this._sun_arc || !this._sun_root) return;

					const tokenAtCall = this._sunRenderToken;
					const next = (pgn ?? "").trim();
					if (next === (this._lastFocusedPgn ?? "")) return;

					this._lastFocusedPgn = next;
					this.#focusSunburstFromPgn(next, 250, tokenAtCall);
				});
			}
			this._winRateBar = document.getElementById("oe-winrate-bar");

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

				// Only rebuild when the dataset slice changes (not on every move)
				const sunburstKey = `${this.filters.time_control}|${this.filters.elo}|${this.filters.opening}`;
				if (sunburstKey !== this._lastSunburstKey) {
					this._lastSunburstKey = sunburstKey;
					await this.initSunburst();
				}

				// Always focus to current PGN (works for moves + reset)
				const pgnNow = (openingExplorerState.getPGN?.() ?? "").trim();
				this._lastFocusedPgn = pgnNow;
				this.#focusSunburstFromPgn(pgnNow, 0, this._sunRenderToken);
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

		const focusMoves = matchedMoves.slice(1).join(" ");

		return { rootNode, focusMoves, openingPgn: pgn };
	}

	async initSunburst() {
		const chartEl = this.container;
		if (!chartEl || !this.data) return;

		const myToken = ++this._sunRenderToken;

		// interrupt any running transitions before destroying DOM
		try {
			d3.select(chartEl).selectAll("*").interrupt();
		} catch (_) { }

		// drop references to avoid using stale selections
		this._sun_vis = null;
		this._sun_arc = null;
		this._sun_root = null;
		this._current_root = null;

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

		// subtree root marker
		this._subtreeRootSan = null;

		if (opening && opening !== "All") {
			const traversal = this.#findTreeRootAndFocusFromOpening(rawData, opening);

			if (!traversal?.rootNode) {
				this._sun_vis
					.append("text")
					.attr("text-anchor", "middle")
					.style("fill", "white")
					.text(`Opening not found (by moves): ${opening}`);
				return;
			}

			this._subtreeRootSan = traversal.rootNode?.move ?? null;
			focusMoves = traversal.focusMoves;

			hierarchyData = {
				name: opening,
				variant: traversal.rootNode.variant || "Unknown",
				_isMove: false,
				children: [this._sun_recursiveTransform(traversal.rootNode)],
			};
		} else {
			hierarchyData = {
				name: "All Openings",
				variant: "",
				_isMove: false,
				children: rawData.map((v) => this._sun_recursiveTransform(v)),
			};
		}

		this._sun_createVisualization(hierarchyData, this._sun_radius);

		// focus only if still the current render
		if (myToken === this._sunRenderToken && opening && opening !== "All") {
			this._lastFocusedPgn = focusMoves;
			this.#focusSunburstFromPgn(focusMoves, 0, myToken);
		}
	}

	_sun_recursiveTransform(data) {
		const isMove = !!data.move;
		const node = {
			move: data.move,
			name: data.name || "Unknown",
			variant: data.variant || null,
			_isMove: isMove,
			// keep raw stats (white wins, draws, black wins) when present
			stats: Array.isArray(data.stats) ? data.stats.slice(0, 3) : [0, 0, 0],
			games: data.count || 0,
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

		// if in subtree mode, start at subtree root
		if (this.filters.opening && this.filters.opening !== "All") {
			cur = cur.children?.[0] ?? cur;
		}

		for (const san of sans) {
			const next = (cur.children || []).find((c) => c?.data?.move === san);
			if (!next) return null;
			cur = next;
		}

		return cur;
	}

	#applyZoomToNode(d, arc, radius, durationMs, token) {
		if (token !== this._sunRenderToken) return;
		if (!this._sun_vis || !this._sun_x || !this._sun_y) return;

		// cancel any running zoom transition before starting a new one
		try {
			this._sun_vis.interrupt();
		} catch (_) { }

		this._current_root = d;

		// make everything visible before re-hiding at end
		this._sun_vis.selectAll("path").style("display", null);

		const transition = this._sun_vis.transition().duration(durationMs);

		const xd = d3.interpolate(this._sun_x.domain(), [d.x0, d.x1]);
		const yd = d3.interpolate(this._sun_y.domain(), [d.y0, 1]);
		const yr = d3.interpolate(this._sun_y.range(), [0, radius]);

		this._sun_vis
			.selectAll("path")
			.transition(transition)
			.attrTween("d", (node) => (t) => {
				// if a new render happened mid-transition, stop mutating scales
				if (token !== this._sunRenderToken) return arc(node);
				this._sun_x.domain(xd(t));
				this._sun_y.domain(yd(t)).range(yr(t));
				return arc(node);
			});

		transition.on("end", () => {
			if (token !== this._sunRenderToken) return;
			this._sun_vis
				.selectAll("path")
				.style("display", (node) => (node.ancestors().includes(d) ? null : "none"));
		});
	}

	#focusSunburstFromPgn(pgnMovetext, durationMs = 350, token = this._sunRenderToken) {
		if (token !== this._sunRenderToken) return;
		if (!this._sun_vis || !this._sun_arc || !this._sun_root) return;

		if (!pgnMovetext || !pgnMovetext.trim()) {
			this.#applyZoomToNode(this._sun_root, this._sun_arc, this._sun_radius, durationMs, token);
			if (this._winRateBar) d3.select(this._winRateBar).selectAll("*").remove();
			return;
		}

		let sans = this.#tokenizeMovetextToSans(pgnMovetext);

		// subtree mode: strip the subtree root move if present
		if (this.filters.opening && this.filters.opening !== "All") {
			if (this._subtreeRootSan && sans[0] === this._subtreeRootSan) {
				sans = sans.slice(1);
			}
		}

		const target = this.#findNodeForSansSequence(sans);
		if (!target) return;

		// update win-rate bar for focused node
		try {
			if (target?.data) this._drawWinRateBar(target.data);
		} catch (e) {
			console.error('Error drawing win-rate bar:', e);
		}

		this.#applyZoomToNode(target, this._sun_arc, this._sun_radius, durationMs, token);
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
			.map((n) => n.data.move);

		// If user goes back to root and we trigger opening=All => rerender,
		if (moves.length === 0) {
			openingExplorerState.setPGN("", { source: "sunburst_zoom" });
			this.#setSelectValue("opening", "All");
			return;
		}

		const numbered = this.#formatSansMovesToNumberedPgn(moves);
		openingExplorerState.setPGN(numbered, { source: "sunburst_zoom" });

		this.#applyZoomToNode(d, arc, radius, 650, this._sunRenderToken);
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
			.style("fill", (d) => colorScale(d.ancestors().reverse()[1]?.data.move))
			.style("stroke", "#0b1220")
			.style("display", (d) => (d.depth > 0 ? null : "none"))
			.on("click", (event, d) => {
				this._drawWinRateBar(d.data);
				this._sun_zoom(event, d, arc, radius);
			})
			.on("mouseover", (event, d) => {
				const tooltip = document.getElementById("tooltip");
				if (tooltip) {
					tooltip.style.opacity = 1;
					if (d.data.variant) tooltip.innerHTML = `<strong>${d.data.name}</strong><br>Move: ${d.data.move}<br>${d.data.variant}<br>Games: ${d.value}`;
					else tooltip.innerHTML = `<strong>${d.data.name}</strong><br>Move: ${d.data.move}<br>Games: ${d.value}`;
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
				if (this.last_hovered_node) this.last_hovered_node.style("opacity", 1);
				this.last_hovered_node = null;
			});
	}

	_drawWinRateBar(data) {
		const container = this._winRateBar;
		console.log("Drawing win rate bar in container:", container, "with data:", data);
		if (!container) return;
		// clear previous content
		d3.select(container).selectAll("*").remove();

		const stats = Array.isArray(data?.stats) ? data.stats.slice(0, 3) : [0, 0, 0];
		const total = stats.reduce((s, v) => s + (Number(v) || 0), 0);
		if (!total) {
			d3.select(container)
				.append("div")
				.style("color", "#ffffff")
				.style("font-size", "12px")
				.text("No games available");
			return;
		}

		const pct = stats.map((v) => (Number(v) || 0) / total);
		const width = this.width - 24;
		const height = 40;

		const svg = d3
			.select(container)
			.append("svg")
			.attr("width", width)
			.attr("height", height);

		const colors = ["#ffffff", "#9e9e9e", "#000000"]; // white wins, draws, black wins

		let x = 0;
		const g = svg.append("g");
		for (let i = 0; i < 3; i++) {
			const w = Math.round(pct[i] * width);
			g.append("rect")
				.attr("x", x)
				.attr("y", 2)
				.attr("width", w)
				.attr("height", height - 4)
				.style("fill", colors[i])
				.style("stroke", "#222")
				.style("stroke-width", "1px");

			const label = `${Math.round(pct[i] * 100)}%`;
			if (w > 36) {
				g.append("text")
					.attr("x", x + w / 2)
					.attr("y", height / 2 + 4)
					.attr("text-anchor", "middle")
					.style("font-size", "11px")
					.style("pointer-events", "none")
					.style("fill", i === 0 ? "#000" : "#fff")
					.text(label);
			} else if (w > 0) {
				g.append("text")
					.attr("x", x + w + 6)
					.attr("y", height / 2 + 4)
					.style("font-size", "11px")
					.style("pointer-events", "none")
					.style("fill", "#fff")
					.text(label);
			}

			x += w;
		}
	}


	// Chessboard

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
				document.getElementById("oe-opening-title").textContent = "All Openings";
				document.getElementById("oe-opening-variant").textContent = "";
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

	getDisplayedOpeningInfo(pgnMovetext) {
		const openingTitle =
			this.filters?.opening && this.filters.opening !== "All"
				? this.filters.opening
				: "All Openings";

		let variant = "";
		let title = openingTitle;

		if (!this._sun_root) {
			return { title, variant };
		}

		let sans = this.#tokenizeMovetextToSans(pgnMovetext || "");

		// subtree mode: strip subtree root move if present (same logic as focus)
		if (this.filters.opening && this.filters.opening !== "All") {
			if (this._subtreeRootSan && sans[0] === this._subtreeRootSan) {
				sans = sans.slice(1);
			}
		}

		const node = this.#findNodeForSansSequence(sans);
		if (node?.data) {
			// node.data.name is usually the opening/line name in your JSON
			if (node.data.name && node.data.name !== "Unknown") title = node.data.name;
			if (node.data.variant && node.data.variant !== "Unknown") variant = node.data.variant;
		}

		return { title, variant };
	}
}

export { OpeningExplorerVisualization };
