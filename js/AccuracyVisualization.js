import { Visualization } from './Visualization.js';

class AccuracyVisualization extends Visualization {
	constructor(dataPath, container) {
		super(dataPath, container, {top: 20, right: 30, bottom: 60, left: 60});
	}

	render(time_control, elo, color, opening) {
		this.init().then(() => {
			this.filters.time_control = time_control;
			this.filters.elo = elo;
			this.filters.color = Number.parseInt(color);
			this.filters.opening = opening;

			const filtered = this.preprocess();
			this.drawSquares(filtered);
		}).catch(err => console.error(err));
	}

	// === Private methods ===

	computeScales() {
		const domain = d3.range(0, 100, 10); // [0,10,...,90]

		this.scales = this.scales || {};

		this.scales.x = d3.scaleBand()
			.range([0, this.innerW])
			.domain(domain)
			.padding(0.02);

		this.scales.y = d3.scaleBand()
			.range([0, this.innerH])
			.domain(domain.slice().reverse()) // [90..0]
			.padding(0.02);

		this.scales.color = d3.scaleSequential()
			.interpolator(d3.interpolateRdYlGn)
			.domain([0, 1]);
	}

	drawAxes() {
		const tickVals = d3.range(0, 110, 10); // show labels 0..100

		// X axis
		const xAxisG = this.g.axes.selectAll('.x-axis').data([0]);
		const xG = xAxisG.join('g').attr('class', 'x-axis')
			.attr('transform', `translate(0, ${this.innerH})`)
			.call(
				d3.axisBottom(this.scales.x)
					.tickValues(tickVals)
					.tickFormat(d => `${d}%`)
			);

		xG.selectAll('.tick')
			.attr('transform', d => `translate(${d === 100 ? this.innerW : this.scales.x(d)},0)`);

		// X axis label
		this.g.axes.selectAll('.x-label').data([0]).join('text')
			.attr('class', 'x-label')
			.attr('x', this.innerW / 2)
			.attr('y', this.innerH + this.margins.bottom - 30)
			.attr('text-anchor', 'middle')
			.style('font-size', '14px')
			.style('fill', '#ffffff')
			.text('Mean accuracy during opening');

		// Y axis
		const yAxisG = this.g.axes.selectAll('.y-axis').data([0]);
		const yG = yAxisG.join('g').attr('class', 'y-axis')
			.call(
				d3.axisLeft(this.scales.y)
					.tickValues(tickVals)
					.tickFormat(d => `${d}%`)
			);

		const bw = this.scales.y.bandwidth();

		yG.selectAll('.tick')
			.attr('transform', d => {
				if (d === 100) return `translate(0,0)`;
				const y = this.scales.y(d);
				return `translate(0,${y + bw})`;
			});

		// Y axis label
		this.g.axes.selectAll('.y-label').data([0]).join('text')
			.attr('class', 'y-label')
			.attr('transform', 'rotate(-90)')
			.attr('x', -(this.innerH / 2))
			.attr('y', -this.margins.left + 15)
			.attr('text-anchor', 'middle')
			.style('font-size', '14px')
			.style('fill', '#ffffff')
			.text("Mean accuracy after opening");
	}

	preprocess() {
		const cadence = this.filters.time_control;
		const eloKey = this.filters.elo;
		const color = this.filters.color;
		const opening = this.filters.opening;

		if (!this.data?.payload) return [];
		const payload = this.data.payload;
		if (!payload?.[cadence]?.[eloKey]?.[opening]) return [];

		const entry = payload[cadence][eloKey][opening];
		const matrice = entry.heatmap;
		const nb_games = entry.cell_samples;

		if (!matrice || matrice.length === 0) return [];

		const dataset = [];
		matrice.forEach((row, yIndex) => {
			row.forEach((winRate, xIndex) => {
				dataset.push({
					x: xIndex * 10,
					y: yIndex * 10,
					value: winRate[color],
					games: nb_games?.[yIndex]?.[xIndex][color] || 0
				});
			});
		});

		return dataset;
	}

	drawSquares(data) {
		const rects = this.g.marks.selectAll('rect').data(data, d => `${d.x}-${d.y}`);

		rects.enter()
			.append('rect')
			.merge(rects)
			.transition().duration(200)
			.attr('x', d => this.scales.x(d.x))
			.attr('y', d => this.scales.y(d.y))
			.attr('width', () => this.scales.x.bandwidth())
			.attr('height', () => this.scales.y.bandwidth())
			.style('fill', d => d.games === 0 ? '#2d3a58ff' : this.scales.color(d.value))
			.style('stroke', 'none');

		this.g.marks.selectAll('rect')
			.on('mouseover', (event, d) => {
				this.showTooltip(`Win rate : ${(d.value * 100).toFixed(1)}%<br/>Number of games : ${d.games}`, event);
				d3.select(event.currentTarget).raise();
			})
			.on('mouseout', () => this.hideTooltip());

		rects.exit().remove();
	}
}

export { AccuracyVisualization };