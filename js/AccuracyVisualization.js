import { Visualization } from './Visualization.js';

class AccuracyVisualization extends Visualization {
	constructor(data, container, options = {}) {
		super(data, container, Object.assign({ margins: { top: 30, right: 30, bottom: 60, left: 60 } }, options));
		this.crossSize = 3;
	}
}

export { AccuracyVisualization };