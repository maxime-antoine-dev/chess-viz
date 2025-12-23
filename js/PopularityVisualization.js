import { Visualization } from './Visualization.js';

class PopularityVisualization extends Visualization {
	constructor(data, container, options = {}) {
		super(data, container, { top: 30, right: 30, bottom: 60, left: 60 });
		this.crossSize = 3;
		this.scales = { x: null, y: null };
	}

	render(time_control, elo) {
		this.init().then(() => {
			this.filters.time_control = time_control;
			this.filters.elo = elo;

			// clear previous axis/marks
			this.g.axes.selectAll('*').remove();
			this.g.marks.selectAll('*').remove();

			const filtered = this._preprocess();
			this._computeScales(filtered);
			this._drawAxes();
			this._bindMarks(filtered);
		}).catch(err => console.error(err));
	}


	// === Private methods ===

	// preprocess loadedData according to this.filters
	_preprocess() {
		const filters = this.filters || {};
		const cadence = filters.time_control || 'blitz';
		const eloKey = filters.elo || '1000_1500';

		const dataRoot = this.data;
		if (!dataRoot || !dataRoot[cadence]) return [];
		const band = dataRoot[cadence][eloKey];
		if (!Array.isArray(band)) return [];

		// return items with required fields
		return band.filter(d => d && d.popularity !== undefined && d.win_rate !== undefined)
			.map(d => ({ name: d.name, popularity: d.popularity, win_rate: d.win_rate }));
	}

	_computeScales(data) {
		const maxPop = d3.max(data, d => d.popularity) || 0.1;
		const minWin = d3.min(data, d => d.win_rate) || 0.4;
		const maxWin = d3.max(data, d => d.win_rate) || 0.6;

		this.scales.x = d3.scaleLinear().domain([0, maxPop * 1.1]).range([0, this.innerW]);
		this.scales.y = d3.scaleLinear().domain([minWin * 0.95, maxWin * 1.05]).range([this.innerH, 0]);
	}

	_drawAxes() {
		// X axis
		const xAxisG = this.g.axes.selectAll('.x-axis').data([0]);
		xAxisG.join('g').attr('class', 'x-axis')
			.attr('transform', `translate(0, ${this.innerH})`)
			.call(d3.axisBottom(this.scales.x).tickFormat(d => this.formatPercent(d, 0)));

		// Y axis
		const yAxisG = this.g.axes.selectAll('.y-axis').data([0]);
		yAxisG.join('g').attr('class', 'y-axis')
			.call(d3.axisLeft(this.scales.y).tickFormat(d => this.formatPercent(d, 0)));
	}

	_bindMarks(data) {
		const crosses = this.g.marks.selectAll('.cross').data(data, d => d.name);

		// exit
		crosses.exit().transition().duration(150).style('opacity', 0).remove();

		// enter
		const enter = crosses.enter().append('g').attr('class', 'cross').style('opacity', 0);
		enter.append('line').attr('class', 'cross-a').attr('stroke', 'black').attr('stroke-width', 2);
		enter.append('line').attr('class', 'cross-b').attr('stroke', 'black').attr('stroke-width', 2);

		const merged = enter.merge(crosses);

		merged.transition().duration(200).style('opacity', 1)
			.attr('transform', d => `translate(${this.scales.x(d.popularity)}, ${this.scales.y(d.win_rate)})`);

		merged.select('.cross-a')
			.attr('x1', -this.crossSize).attr('y1', -this.crossSize)
			.attr('x2', this.crossSize).attr('y2', this.crossSize);
		merged.select('.cross-b')
			.attr('x1', -this.crossSize).attr('y1', this.crossSize)
			.attr('x2', this.crossSize).attr('y2', -this.crossSize);

		// hover
		merged
			.on('mouseover', (event, d) => {
				// highlight the lines inside the group rather than setting attrs on the group
				d3.select(event.currentTarget).selectAll('line').attr('stroke-width', 3);
				d3.select(event.currentTarget).attr('transform', `translate(${this.scales.x(d.popularity)}, ${this.scales.y(d.win_rate)}) scale(1.5)`);
				this.showTooltip(`<strong>${d.name}</strong><br>Popularité: ${this.formatPercent(d.popularity, 2)}<br>Victoire (Blancs): ${this.formatPercent(d.win_rate, 2)}`, event);
			})
			.on('mouseout', (event, d) => {
				d3.select(event.currentTarget).selectAll('line').attr('stroke-width', 2);
				d3.select(event.currentTarget).attr('transform', `translate(${this.scales.x(d.popularity)}, ${this.scales.y(d.win_rate)}) scale(1)`);
				this.hideTooltip();
			});
	}


}

export { PopularityVisualization };