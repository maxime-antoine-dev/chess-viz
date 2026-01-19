import { OpeningExplorerVisualization } from './OpeningExplorerVisualization.js';
import { PopularityVisualization } from './PopularityVisualization.js';
import { AccuracyVisualization } from './AccuracyVisualization.js';
import { openingExplorerState } from './OpeningExplorerState.js';
import { OPENING_FIRST_MOVES } from './openings.js';

let time_control = "rapid";
let elo = "1500-2000";
let color = "1"; // White
let opening = "All";

const charts = init();
update(charts, time_control, elo, color, opening);
updateBoardDetails();

// Helpers

function detectOpeningFromPgnPrefix(pgnMovetext) {
	const entries = Object.entries(OPENING_FIRST_MOVES || {})
		.filter(([k, v]) => k !== "All" && v)
		.sort((a, b) => b[1].length - a[1].length);

	for (const [name, prefix] of entries) {
		if ((pgnMovetext || "").startsWith(prefix)) return name;
	}
	return null;
}

function syncSelect(id, value) {
	const el = document.getElementById(id);
	if (!el) return;
	if (el.value !== value) el.value = value;
}

// Details panel

function updateBoardDetails() {
	const titleEl = document.getElementById("oe-opening-title");
	const variantEl = document.getElementById("oe-opening-variant");
	const pgnEl = document.getElementById("oe-current-pgn");
	if (!titleEl || !variantEl || !pgnEl) return;

	const pgn = (openingExplorerState.getPGN?.() ?? "").trim().replaceAll("*", "");

	let info = { title: (opening !== "All" ? opening : "All Openings"), variant: "" };
	if (charts?.openingExplorer?.getDisplayedOpeningInfo) {
		info = charts.openingExplorer.getDisplayedOpeningInfo(pgn) || info;
	}

	titleEl.textContent = info.title || (opening !== "All" ? opening : "All Openings");
	variantEl.textContent = `${info.variant ? info.variant : ""}`;
	pgnEl.textContent = pgn ? pgn : "";
}

// set filters + update charts
function setExplorerFilters(partial = {}, meta = {}) {
	if (partial.time_control != null) time_control = String(partial.time_control);
	if (partial.elo != null) elo = String(partial.elo);
	if (partial.color != null) color = String(partial.color);
	if (partial.opening != null) opening = String(partial.opening);

	// keep UI in sync
	syncSelect("time_control", time_control);
	syncSelect("elo", elo);
	syncSelect("color", color);
	syncSelect("opening", opening);

	// only when the opening is explicitly selected (UI/popularity) we load its base PGN
	if (meta.setBasePGN && partial.opening != null) {
		const pgn = (opening && opening !== "All") ? (OPENING_FIRST_MOVES?.[opening] ?? "") : "";
		openingExplorerState.setPGN(pgn, { source: meta.source ?? "opening_select", force: true });
	}

	update(charts, time_control, elo, color, opening);
	updateBoardDetails();
}

// set PGN (board/sunburst/reset) + ensure charts are re-rendered if needed
function setExplorerPGN(pgn, meta = {}) {
	openingExplorerState.setPGN(pgn ?? "", { source: meta.source ?? "external", force: !!meta.force });
	update(charts, time_control, elo, color, opening);
	updateBoardDetails();
}

// expose for other visualizations (minimal change)
window.setExplorerFilters = setExplorerFilters;
window.setExplorerPGN = setExplorerPGN;

//  UI listeners

document.getElementById("time_control").addEventListener("change", function () {
	setExplorerFilters({ time_control: this.value }, { source: "ui_time" });
});

document.getElementById("elo").addEventListener("change", function () {
	setExplorerFilters({ elo: this.value }, { source: "ui_elo" });
});

document.getElementById("color").addEventListener("change", function () {
	setExplorerFilters({ color: this.value }, { source: "ui_color" });
});

document.getElementById("opening").addEventListener("change", function () {
	// user explicitly picked an opening -> we load base PGN
	setExplorerFilters({ opening: this.value }, { source: "ui_opening", setBasePGN: true });
});

// keep opening filter in sync when PGN changes (board/sunburst)
openingExplorerState.onPGNChange(({ pgn, source }) => {
	const detected = detectOpeningFromPgnPrefix(pgn || "");

	// reset case
	if (!pgn || !pgn.trim()) {
		if (opening !== "All") setExplorerFilters({ opening: "All" }, { source: "pgn_reset" });
		updateBoardDetails();
		return;
	}

	// when pgn evolves (board move / sunburst), update opening filter
	if (detected && detected !== opening) {
		setExplorerFilters({ opening: detected }, { source: "pgn_detect", setBasePGN: false });
		updateBoardDetails();
		return;
	}

	updateBoardDetails();
});

function init() {
	let charts = {};
	charts.openingExplorer = new OpeningExplorerVisualization(
		"./data/openingExplorer.json",
		document.getElementById("opening_explorer"),
		document.getElementById("chessboard")
	);
	charts.popularity = new PopularityVisualization("./data/popularity.json", document.getElementById("popularity"));
	charts.accuracy = new AccuracyVisualization("./data/accuracy.json", document.getElementById("accuracy"));
	return charts;
}

function update(charts, time_control, elo, color, opening) {
	charts.openingExplorer.render(time_control, elo, color, opening);
	charts.popularity.render(time_control, elo, color, opening);
	charts.accuracy.render(time_control, elo, color, opening);
}
