import { OpeningExplorerVisualization } from './OpeningExplorerVisualization.js';
import { PopularityVisualization } from './PopularityVisualization.js';
import { AccuracyVisualization } from './AccuracyVisualization.js';

let time_control = "rapid";
let elo = "500-1000";
const charts = init(time_control, elo);
update(charts, time_control, elo);

document.getElementById("time_control").addEventListener("change", function() {
	time_control = this.value;
	update(charts, time_control, elo);
});

document.getElementById("elo").addEventListener("change", function() {
	elo = this.value;
	update(charts, time_control, elo);
});

document.getElementById("opening").addEventListener("change", function() {
    charts.accuracy.render(time_control, elo);
})

function init(time_control, elo) {
	// Create charts object
	let charts = {};
	charts.openingExplorer = new OpeningExplorerVisualization("../data/openingExplorer.json", document.getElementById("opening_explorer"));
	charts.popularity = new PopularityVisualization("../data/popularity.json", document.getElementById("popularity"));
	charts.accuracy = new AccuracyVisualization("../data/accuracy.json", document.getElementById("accuracy"));

	// Initialize charts
	// charts.openingExplorer.render();
	charts.popularity.render(time_control, elo);
	charts.accuracy.render(time_control, elo);

	return charts;
}

function update(charts, time_control, elo) {
	// charts.openingExplorer.render();
	charts.popularity.render(time_control, elo);
	charts.accuracy.render(time_control, elo);
}