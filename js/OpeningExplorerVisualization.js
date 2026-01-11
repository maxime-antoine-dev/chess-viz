import { Visualization } from "./Visualization.js";
import { openingExplorerState } from "./OpeningExplorerState.js";
import { ChessboardWidget } from "./Chessboard.js";
import { OPENING_FIRST_MOVES } from "./openings.js";

class OpeningExplorerVisualization extends Visualization {

	constructor(data, container, chessboardContainer) {
		super(data, container, { top: 0, right: 0, bottom: 0, left: 0 });
		this.chessboardContainer = chessboardContainer;
		this._boardWidget = null;
		this._lastOpeningApplied = null;
		this._lastColorApplied = null;
		this._unsub = null;
		this.initialized = false;
		this._sun_vis = null;
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

		this.init().then(async () => {
			if (this._lastColorApplied !== color) {
				this._lastColorApplied = color;
				const ori = String(color) === "2" ? "black" : "white";
				this._boardWidget.setOrientation(ori);
			}

			if (this._lastOpeningApplied !== opening) {
				this._lastOpeningApplied = opening;
				let pgn = "";
				if (opening && opening !== "All") {
					pgn = OPENING_FIRST_MOVES?.[opening] ?? "";
				}
				openingExplorerState.setPGN(pgn);
			}
			await this.initSunburst();

		}).catch((err) => console.error("Render error:", err));
	}



	async initSunburst() {
		const chartEl = this.container;
		if (!chartEl || !this.data) return;

		d3.select(chartEl).selectAll("*").remove();

		const radius = Math.min(this.width, this.height) / 2;

		this._sun_vis = d3.select(chartEl)
			.append("svg")
			.attr("viewBox", `0 0 ${this.width} ${this.height}`)
			.append("g")
			.attr("transform", `translate(${this.width / 2},${this.height / 2})`);

		const tc = this.filters.time_control;
		const elo = this.filters.elo;
		const opening = this.filters.opening;

		let rawData = this.data?.payload?.[tc]?.[elo];

		if (!rawData || !Array.isArray(rawData)) {
			this._sun_vis.append("text").attr("text-anchor", "middle").style("fill", "white").text("No data");
			return;
		}

		let hierarchyData;

		if (opening && opening !== "All") {
			const targetData = rawData.find(d => d.name === opening);
			if (!targetData) {
				this._sun_vis.append("text").attr("text-anchor", "middle").style("fill", "white").text("Opening not found");
				return;
			}
			hierarchyData = {
				name: opening,
				children: [this._sun_recursiveTransform(targetData)]
			};
		} else {
			// "All Openings" root
			hierarchyData = {
				name: "All Openings",
				children: rawData.map(v => this._sun_recursiveTransform(v))
			};
		}

		this._sun_createVisualization(hierarchyData, radius);
	}

	_sun_recursiveTransform(data) {
		const node = {
			name: data.move || data.name || "???"
		};

		if (data.children && Array.isArray(data.children) && data.children.length > 0) {
			node.children = data.children.map(cv => this._sun_recursiveTransform(cv));
		} else {
			node.size = data.count || 1;
		}

		if (data.count) node.value = data.count;
		return node;
	}

	_sun_createVisualization(json, radius) {
		const partition = d3.partition().size([2 * Math.PI, radius]);
		const root = d3.hierarchy(json)
			.sum(d => d.size || 0)
			.sort((a, b) => b.value - a.value);

		partition(root);

		const arc = d3.arc()
			.startAngle(d => d.x0)
			.endAngle(d => d.x1)
			.innerRadius(d => d.y0)
			.outerRadius(d => d.y1);

		const colorScale = d3.scaleOrdinal(d3.quantize(d3.interpolateRainbow, root.children?.length + 1 || 2));
		let selectedNode = null;

		const path = this._sun_vis.selectAll("path")
			.data(root.descendants().filter(d => d.depth && (d.x1 - d.x0 > 0.001)))
			.enter().append("path")
			.attr("d", arc)
			.style("cursor", "pointer")
			.style("fill", d => colorScale(d.ancestors().reverse()[1]?.data.name))
			.style("stroke", "#0b1220")
			.style("opacity", 0.8)
			.on("click", (event, d) => {
				console.log("Clicked on:", d.data.name);
				selectedNode = (d === selectedNode) ? null : d;
				console.log("Selected node:", selectedNode ? selectedNode.data.name : "none");
				if (selectedNode) {
					const ancestors = selectedNode.ancestors();
					path.transition().duration(200).style("opacity", node => ancestors.includes(node) ? 1 : 0.3);
					const nodeName = selectedNode.data.name;
					let pgnToApply = "";
					if (OPENING_FIRST_MOVES?.[nodeName]) {
						pgnToApply = OPENING_FIRST_MOVES[nodeName];
					} else {
						pgnToApply = selectedNode.ancestors().reverse().slice(1).map(n => n.data.name).join(" ");
					}

					console.log("Move list to set in OpeningExplorerState:", pgnToApply);
					if (openingExplorerState) {
						openingExplorerState.setPGN(pgnToApply, { source: "sunburst" });
					}
				} else {
					path.transition().duration(200).style("opacity", 0.8);
				}
				event.stopPropagation(event);
			})
			.on("mouseover", (event, d) => {
				const tooltip = document.getElementById("tooltip");
				if (tooltip) {
					tooltip.style.opacity = 1;
					tooltip.innerHTML = `<strong>${d.data.name}</strong><br>Games: ${d.value}`;
				}
			})
			.on("mousemove", (event) => {
				const tooltip = document.getElementById("tooltip");
				if (tooltip) {
					tooltip.style.left = (event.pageX + 10) + "px";
					tooltip.style.top = (event.pageY - 10) + "px";
				}
			})
			.on("mouseleave", () => {
				const tooltip = document.getElementById("tooltip");
				if (tooltip) tooltip.style.opacity = 0;
			});
	}


	// === Chessboard===

	async initBoardWidget() {
		const boardEl = this.chessboardContainer.querySelector("#oe-board");
		const btnReset = this.chessboardContainer.querySelector("#oe-reset");
		const btnFlip = this.chessboardContainer.querySelector("#oe-flip");

		if (!boardEl) return;

		this._boardWidget = new ChessboardWidget({ store: openingExplorerState });
		await this._boardWidget.mount({ boardEl });

		if (btnReset) {
			btnReset.addEventListener("click", () => {
				document.getElementById("opening").value = "All";
				openingExplorerState.setPGN("", { source: "reset", force: true });
			});
		}
		if (btnFlip) btnFlip.addEventListener("click", () => this._boardWidget.flip());

		this._unsub = openingExplorerState.onPGNChange(({ pgn }) => {
			const detected = this.detectOpeningFromPgnPrefix(pgn || "");
			const opSel = document.getElementById("opening");
			if (detected && opSel) opSel.value = detected;
		});
	}

	detectOpeningFromPgnPrefix(pgnMovetext) {
		const entries = Object.entries(OPENING_FIRST_MOVES || {})
			.filter(([k, v]) => k !== "All" && v)
			.sort((a, b) => b[1].length - a[1].length);

		for (const [name, prefix] of entries) {
			if (pgnMovetext.startsWith(prefix)) return name;
		}
		return null;
	}
}

export { OpeningExplorerVisualization };
