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
}

export { OpeningExplorerVisualization };
