import { Visualization } from './Visualization.js';

class PopularityVisualization extends Visualization {
	constructor(dataPath, container) {
		super(dataPath, container, {top: 30, right: 30, bottom: 60, left: 60});
		this.crossSize = 3;
		this.scales = { x: null, y: null };
	}

	render(time_control, elo, color, opening) {
		this.init().then(() => {
			this.filters.time_control = time_control;
			this.filters.elo = elo;
			this.filters.color = Number.parseInt(color);
			this.filters.opening = opening;

			const filtered = this.preprocess();
			this.bindMarks(filtered);
		}).catch(err => console.error(err));
	}


	// === Private methods ===

	computeScales() {
		const payload = this.data.payload;
		let maxPop = -Infinity;
		let minWin = Infinity;
		let maxWin = -Infinity;

		for (const cadenceKey in payload) {
			const cadence = payload[cadenceKey];
			for (const eloKey in cadence) {
				const band = cadence[eloKey];
				band.forEach(d => {
					maxPop = Math.max(maxPop, d.popularity);
					d.win_rate.forEach(w => {
						minWin = Math.min(minWin, w);
						maxWin = Math.max(maxWin, w);
					});
				});
			}
		}

		if (!Number.isFinite(maxPop) || maxPop <= 0) maxPop = 1;
		if (!Number.isFinite(minWin)) minWin = 0;
		if (!Number.isFinite(maxWin)) maxWin = 1;

		this.scales.x = d3.scaleLinear().domain([0, maxPop * 1.1]).range([0, this.innerW]);
		this.scales.y = d3.scaleLinear().domain([minWin * 0.95, maxWin * 1.05]).range([this.innerH, 0]);
	}

	drawAxes() {
		// X axis
		const xAxisG = this.g.axes.selectAll('.x-axis').data([0]);
		xAxisG.join('g').attr('class', 'x-axis')
			.attr('transform', `translate(0, ${this.innerH})`)
			.call(d3.axisBottom(this.scales.x).tickFormat(d => this.formatPercent(d, 0)));

		// X axis label
		this.g.axes.selectAll('.x-label').data([0]).join('text')
			.attr('class', 'x-label')
			.attr('x', this.innerW / 2)
			.attr('y', this.innerH + this.margins.bottom - 20)
			.attr('text-anchor', 'middle')
			.style('font-size', '14px')
			.text('Popularity (% of games played)');

		// Y axis
		const yAxisG = this.g.axes.selectAll('.y-axis').data([0]);
		yAxisG.join('g').attr('class', 'y-axis')
			.call(d3.axisLeft(this.scales.y).tickFormat(d => this.formatPercent(d, 0)));

		// Y axis label
		const color = this.filters.color === 1 ? 'White' : this.filters.color === 2 ? 'Black' : 'Both';
		this.g.axes.selectAll('.y-label').data([0]).join('text')
			.attr('class', 'y-label')
			.attr('transform', 'rotate(-90)')
			.attr('x', -this.innerH / 2)
			.attr('y', -this.margins.left + 15)
			.attr('text-anchor', 'middle')
			.style('font-size', '14px')
			.text(`Win rate (${color})`);
	}

	preprocess() {
		const cadence = this.filters.time_control;
		const eloKey = this.filters.elo;
		const color = this.filters.color;

		const band = this.data?.payload?.[cadence]?.[eloKey];
		if (!Array.isArray(band)) return [];

		// return items with required fields
		return band.filter(d => d && d.popularity !== undefined && d.win_rate !== undefined)
			.map(d => ({ name: d.name, popularity: d.popularity, win_rate: d.win_rate[color] }));
	}

	bindMarks(data) {
		this.g.marks.selectAll('*').remove();

		const crosses = this.g.marks.selectAll('.cross').data(data, d => d.name);

		// exit
		crosses.exit().transition().duration(150).style('opacity', 0).remove();

		// enter
		const enter = crosses.enter().append('g').attr('class', 'cross').style('opacity', 0);
		enter.append('line').attr('class', 'cross-a').attr('stroke-width', 2);
		enter.append('line').attr('class', 'cross-b').attr('stroke-width', 2);

		const merged = enter.merge(crosses);

		merged.transition().duration(200).style('opacity', 1)
			.attr('transform', d => `translate(${this.scales.x(d.popularity)}, ${this.scales.y(d.win_rate)})`);

		merged.select('.cross-a')
			.attr('x1', -this.crossSize).attr('y1', -this.crossSize)
			.attr('x2', this.crossSize).attr('y2', this.crossSize);
		merged.select('.cross-b')
			.attr('x1', -this.crossSize).attr('y1', this.crossSize)
			.attr('x2', this.crossSize).attr('y2', -this.crossSize);

		// Highlight the selected opening (if any)
		merged.selectAll('line')
			.attr('stroke', d => (this.filters.opening && this.filters.opening !== 'All' && d.name === this.filters.opening) ? 'red' : 'black');

		// Hover interaction
		const color = this.filters.color === 1 ? 'White' : this.filters.color === 2 ? 'Black' : 'Both';
		merged
			.on('mouseover', (event, d) => {
				// highlight the lines (increase width) and scale group; keep stroke color as set
				d3.select(event.currentTarget).selectAll('line').attr('stroke-width', 3);
				d3.select(event.currentTarget).attr('transform', `translate(${this.scales.x(d.popularity)}, ${this.scales.y(d.win_rate)}) scale(1.5)`);
				this.showTooltip(`<strong>${d.name}</strong><br>Popularity: ${this.formatPercent(d.popularity, 2)}<br>Win rate (${color}): ${this.formatPercent(d.win_rate, 2)}`, event);
			})
			.on('mouseout', (event, d) => {
				d3.select(event.currentTarget).selectAll('line').attr('stroke-width', 2);
				d3.select(event.currentTarget).attr('transform', `translate(${this.scales.x(d.popularity)}, ${this.scales.y(d.win_rate)}) scale(1)`);
				this.hideTooltip();
			});
	}
}

export { PopularityVisualization };