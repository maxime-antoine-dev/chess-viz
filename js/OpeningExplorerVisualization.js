import { Visualization } from './Visualization.js';

class OpeningExplorerVisualization extends Visualization {
	constructor(data, container) {
		super(data, container, {top: 0, right: 0, bottom: 0, left: 0}); // TODO: define margins if needed
	}

	render(time_control, elo, color, opening) {
		this.init().then(() => {
			this.filters.time_control = time_control;
			this.filters.elo = elo;
			this.filters.color = Number.parseInt(color);
			this.filters.opening = opening;

			// TODO: implement rendering logic for Opening Explorer
		}).catch(err => console.error(err));
	}
}

export { OpeningExplorerVisualization };