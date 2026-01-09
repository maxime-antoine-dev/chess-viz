import { Visualization } from "./Visualization.js";
import { openingExplorerState } from "./OpeningExplorerState.js";
import { ChessboardWidget } from "./Chessboard.js";
import { OPENING_FIRST_MOVES } from "./openings.js";

class OpeningExplorerVisualization extends Visualization {

	// === Public methods ===

	constructor(data, container) {
		super(data, container, { top: 0, right: 0, bottom: 0, left: 0 });

		this._boardWidget = null;

		this._lastOpeningApplied = null;
		this._lastColorApplied = null;

		this._unsub = null;

		this._Chess = null;
		this._chessImportPromise = null;
	}

	async init() {
		// Avoid re-initialization
		if (this.initialized) return this;

		// Initialize base visualization
		this.loadData()
		this.measure();
		this.setupSVG();
		// this.computeScales();
		// this.drawAxes();

		// Initialize board widget
		await this.initBoardWidget();

		// Initialize sunburst visualization (if #oe-sunburst exists)
		try {
			await this.initSunburst();
		} catch (e) {
			// non-fatal: if sunburst html or data is missing, continue
			console.warn('Sunburst init skipped:', e?.message ?? e);
		}

		this.initialized = true;
		return this;
	}

	render(time_control, elo, color, opening) {
		this.init().then(() => {
			this.filters.time_control = time_control;
			this.filters.elo = elo;
			this.filters.color = Number.parseInt(color);
			this.filters.opening = opening;

			// Orientation follows color
			if (this._lastColorApplied !== color) {
				this._lastColorApplied = color;
				const ori = String(color) === "2" ? "black" : "white";
				this._boardWidget.setOrientation(ori);
			}

			// Opening selection drives PGN (unless it came from board detection)
			if (this._lastOpeningApplied !== opening) {
				this._lastOpeningApplied = opening;

				let pgn = "";
				if (opening && opening !== "All") {
					pgn = OPENING_FIRST_MOVES?.[opening] ?? "";
				}

				openingExplorerState.setPGN(pgn);
			}
		})
		.catch((err) => console.error(err));
	}


	// === Private methods ===

	/**
	 * Initialize the embedded chessboard widget
	 * @returns {Promise<void>}
	 * @throws {Error} If HTML elements are missing
	 */
	async initBoardWidget() {
		// Grab HTML elements
		const boardEl = this.container.querySelector("#oe-board");
		const btnReset = this.container.querySelector("#oe-reset");
		const btnFlip = this.container.querySelector("#oe-flip");
		if (!boardEl || !btnReset || !btnFlip) {
			throw new Error("OpeningExplorer HTML elements missing in #opening_explorer");
		}

		// Board widget
		this._boardWidget = new ChessboardWidget({ store: openingExplorerState });
		await this._boardWidget.mount({ boardEl });

		// Reset button (update selects which triggers script.js updates)
		btnReset.addEventListener("click", () => {
			const openingSelect = document.getElementById("opening");
			const colorSelect = document.getElementById("color");
			if (!openingSelect || !colorSelect) return;

			colorSelect.value = "1";
			openingSelect.value = "All";

			colorSelect.dispatchEvent(new Event("change", { bubbles: true }));
			openingSelect.dispatchEvent(new Event("change", { bubbles: true }));
			openingExplorerState.setPGN("", { source:"reset", force:true })
		});

		// Flip button (update color select which triggers script.js updates)
		btnFlip.addEventListener("click", () => {
			const colorSelect = document.getElementById("color");
			if (!colorSelect) return;

			this._boardWidget.flip();
			const ori = this._boardWidget.getOrientation();
			colorSelect.value = ori === "black" ? "2" : "1"; // never "0"
			colorSelect.dispatchEvent(new Event("change", { bubbles: true }));
		});

		// Subscribe to PGN changes for opening detection
		this._unsub = openingExplorerState.onPGNChange(({ pgn, source }) => {
			const openingSelect = document.getElementById("opening");
			const colorSelect = document.getElementById("color");
			if (!openingSelect || !colorSelect) return;

			const s = (pgn ?? "").toString().trim();

			// Reset rule: empty pgn => opening All + color Both
			if (!s) {
				if (openingSelect.value !== "All") {
					openingSelect.value = "All";
					openingSelect.dispatchEvent(new Event("change", { bubbles: true }));
				}

				colorSelect.value = "1";
				colorSelect.dispatchEvent(new Event("change", { bubbles: true }));
				return;
			}

			// Detect opening from PGN prefix (dictionary)
			const detected = this.detectOpeningFromPgnPrefix(s);

			if (detected && openingSelect.value !== detected) {
				openingSelect.value = detected;
				openingSelect.dispatchEvent(new Event("change", { bubbles: true }));
			}
		});
	}

	/**
	 * Detect opening name from PGN movetext prefix
	 * @param {string} pgnMovetext
	 * @returns {string|null} Opening name or null if not found
	 */
	detectOpeningFromPgnPrefix(pgnMovetext) {
		// longest match wins
		const entries = Object.entries(OPENING_FIRST_MOVES || {})
			.filter(([k, v]) => k !== "All" && typeof v === "string" && v.trim().length > 0)
			.sort((a, b) => b[1].length - a[1].length);

		for (const [name, prefix] of entries) {
			if (pgnMovetext.startsWith(prefix)) return name;
		}
		return null;
	}


	// --- Sunburst visualization (adapted from sequences.js) ---

	/**
	 * Initialize the sunburst visualization
	 * @returns {Promise<void>}
	 * @throws {Error} If data is missing or invalid
	 */
	async initSunburst() {
		const chartEl = this.container.querySelector("#oe-sunburst");
		if (!chartEl) {
			// No sunburst container in DOM — nothing to do.
			return;
		}

		// Dimensions (kept similar to original example)
		const width = 750;
		const height = 600;
		const radius = Math.min(width, height) / 2;

		this._sun_totalSize = 0;

		// Create SVG group
		this._sun_vis = d3.select(chartEl)
			.append("svg:svg")
			.attr("width", width)
			.attr("height", height)
			.append("svg:g")
			.attr("id", "oe-sun-container")
			.attr("transform", "translate(" + width / 2 + "," + height / 2 + ")");

		// Partition and arc (modern d3)
		this._sun_radius = radius;
		this._sun_partition = d3.partition().size([2 * Math.PI, radius]);

		this._sun_arc = d3.arc()
			.startAngle(function(d) { return d.x0; })
			.endAngle(function(d) { return d.x1; })
			.innerRadius(function(d) { return d.y0; })
			.outerRadius(function(d) { return d.y1; });

		// (sequence breadcrumb removed)

		// Build hierarchy from preloaded `this.data` (Visualization.loadData stores JSON in this.data).
		// Choose time_control and elo from filters if present, otherwise default to 'blitz' and '2000+'.
		const time_control = this.filters && this.filters.time_control ? this.filters.time_control : 'blitz';
		const elo = this.filters && this.filters.elo ? this.filters.elo : '2000+';

		if (!this.data || !this.data.payload || !this.data.payload[time_control] || !this.data.payload[time_control][elo]) {
			// fallback: try to use any available payload section
			if (this.data && this.data.payload) {
				// pick first available time_control and elo
				const tcKeys = Object.keys(this.data.payload);
				if (tcKeys.length > 0) {
					const firstTC = tcKeys[0];
					const eloKeys = Object.keys(this.data.payload[firstTC] || {});
					if (eloKeys.length > 0) {
						this._sun_payload_tc = firstTC;
						this._sun_payload_elo = eloKeys[0];
					}
				}
			}
		} else {
			this._sun_payload_tc = time_control;
			this._sun_payload_elo = elo;
		}

		if (!this._sun_payload_tc || !this._sun_payload_elo) {
			throw new Error('No suitable payload found in this.data for sunburst');
		}

		const json = this._sun_buildHierarchyFromPayload(this._sun_payload_tc, this._sun_payload_elo);
		this._sun_createVisualization(json);
	}

	/**
	 * Create the sunburst visualization from hierarchical JSON data
	 * @param {Object} json Hierarchical data
	 * @private
	 */
	_sun_createVisualization(json) {
		// (breadcrumb/sequence display removed)

		// bounding circle
		this._sun_vis.append("svg:circle").attr("r", Math.min(750,600)/2).style("opacity", 0);

		// build root hierarchy and compute partition layout
		const root = d3.hierarchy(json).sum(function(d) { return d.size || 0; });
		this._sun_partition(root);

		const nodes = root.descendants().filter(function(d) { return d.depth && (d.x1 - d.x0 > 0.005); });

		this._sun_vis.data([json]).selectAll("path")
			.data(nodes)
			.enter().append("svg:path")
			.attr("display", function(d) { return d.depth ? null : "none"; })
			.attr("d", (d) => this._sun_arc(d))
			.attr("fill-rule", "evenodd")
			.style("fill", (d) => {
				// generate a distinct-ish color per angular position
				const t = (d.x0 || 0) / (2 * Math.PI);
				return d3.interpolateRainbow(t);
			})
			.style("opacity", 1)
			.on("mouseover", (event, d) => this._sun_mouseover(d));

		// add mouseleave on container group
		d3.select(this._sun_vis.node()).on("mouseleave", (event) => this._sun_mouseleave());

		this._sun_totalSize = root.value;
	}

	/**
	 * Mouseover handler for sunburst segments
	 * @param {Object} d Data node
	 * @private
	 */
	_sun_mouseover(d) {
		// Simple hover: fade non-hovered segments and highlight the hovered one.
		this._sun_vis.selectAll("path").style("opacity", 0.3);
		this._sun_vis.selectAll("path").filter(function(node) { return node === d; }).style("opacity", 1);
	}

	/**
	 * Mouseleave handler for sunburst
	 * @private
	 */
	_sun_mouseleave() {
		this._sun_vis.selectAll("path").on("mouseover", null);

		this._sun_vis.selectAll("path")
			.transition()
			.duration(1000)
			.style("opacity", 1)
			.on("end", function(event, d) {
				d3.select(this).on("mouseover", (event, d) => { this._sun_mouseover(d); });
			}.bind(this));
	}

	/**
	 * Build a d3-compatible hierarchical JSON from this.data.payload
	 * @param {string} time_control
	 * @param {string} elo
	 * @returns {Object}
	 */
	_sun_buildHierarchyFromPayload(time_control, elo) {
		const payload = this.data && this.data.payload && this.data.payload[time_control] && this.data.payload[time_control][elo];
		const root = { name: 'root', children: [] };
		if (!payload) return root;

		for (const [key, node] of Object.entries(payload)) {
			// each top-level key is an opening or first move
			const child = this._sun_convertPayloadNode(key, node);
			root.children.push(child);
		}
		return root;
	}

	// recursive helper: convert payload node to {name, children[]} or {name, size}
	_sun_convertPayloadNode(key, node) {
		const name = node && node.name ? node.name : key;
		const count = node && (node.count || node.size) ? (node.count || node.size) : 0;
		const hasChildren = node && node.next_moves && Object.keys(node.next_moves).length > 0;
		if (!hasChildren) {
			return { name: name, size: count };
		}
		const children = [];
		for (const [k, v] of Object.entries(node.next_moves)) {
			children.push(this._sun_convertPayloadNode(k, v));
		}
		// if this node also has a count, include it as a leaf child to represent frequency
		if (count && count > 0) {
			children.unshift({ name: name + ' (root)', size: count });
		}
		return { name: name, children };
	}

}

export { OpeningExplorerVisualization };
