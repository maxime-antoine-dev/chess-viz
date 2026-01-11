import { OpeningExplorerVisualization } from './OpeningExplorerVisualization.js';
import { PopularityVisualization } from './PopularityVisualization.js';
import { AccuracyVisualization } from './AccuracyVisualization.js';

let time_control = "rapid";
let elo = "1500-2000";
let color = "1"; // White
let opening = "All";
const charts = init();
update(charts, time_control, elo, color, opening);

document.getElementById("time_control").addEventListener("change", function() {
	time_control = this.value;
	update(charts, time_control, elo, color, opening);
});

document.getElementById("elo").addEventListener("change", function() {
	elo = this.value;
	update(charts, time_control, elo, color, opening);
});

document.getElementById("color").addEventListener("change", function() {
	color = this.value;
	update(charts, time_control, elo, color, opening);
});

document.getElementById("opening").addEventListener("change", function() {
    opening = this.value;
    update(charts, time_control, elo, color, opening);
})

function init() {
	let charts = {};
	charts.openingExplorer = new OpeningExplorerVisualization(
		"../data/openingExplorer.json",
		document.getElementById("opening_explorer"), document.getElementById("chessboard")
	);
	charts.popularity = new PopularityVisualization("../data/popularity.json", document.getElementById("popularity"));
	charts.accuracy = new AccuracyVisualization("../data/accuracy.json", document.getElementById("accuracy"));
	return charts;
}

function update(charts, time_control, elo, color, opening) {
	charts.openingExplorer.render(time_control, elo, color, opening);
	charts.popularity.render(time_control, elo, color, opening);
	charts.accuracy.render(time_control, elo, color, opening);
}
