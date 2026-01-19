import { Visualization } from './Visualization.js';

class PopularityVisualization extends Visualization {
	constructor(dataPath, container) {
		super(dataPath, container, { top: 30, right: 30, bottom: 60, left: 60 });
		this.crossSize = 3;
		this.scales = { x: null, y: null };
		// Always ignore openings with < 15 games
		this._minGames = 15;
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

	// Private methods

	computeScales() {
		const payload = this.data.payload;
		let maxPop = -Infinity;
		let minWin = Infinity;
		let maxWin = -Infinity;

		for (const cadenceKey in payload) {
			const cadence = payload[cadenceKey];
			for (const eloKey in cadence) {
				const band = cadence[eloKey];
				for (const d of band) {
					// If count < minGames, skip
					const count = Number.isFinite(d.count) ? d.count : 0;
					if (count < this._minGames) continue;

					// Find max popularity
					maxPop = Math.max(maxPop, d.popularity);

					// Find min/max win rate
					const winRate = d.win_rate;
					minWin = Math.min(minWin, winRate[1], winRate[2]);
					maxWin = Math.max(maxWin, winRate[1], winRate[2]);
				}
			}
		}

		// Handle edge cases
		if (!Number.isFinite(maxPop) || maxPop <= 0) maxPop = 1;
		if (!Number.isFinite(minWin) || !Number.isFinite(maxWin) || minWin >= maxWin) {
			minWin = 0;
			maxWin = 1;
		}

		// Define scales
		this.scales.x = d3.scaleLinear()
			.domain([0, maxPop])
			.range([0, this.innerW]);
		this.scales.y = d3.scaleLinear()
			.domain([minWin, maxWin])
			.range([this.innerH, 0]);
	}

	drawAxes() {
		// X axis
		const xAxisG = this.g.axes.selectAll('.x-axis').data([0]);
		xAxisG.join('g').attr('class', 'x-axis')
			.attr('transform', `translate(0, ${this.innerH})`)
			.call(d3.axisBottom(this.scales.x).tickFormat(d => this.formatPercent(d, 0)));

		this.g.axes.selectAll('.x-label').data([0]).join('text')
			.attr('class', 'x-label')
			.attr('x', this.innerW / 2)
			.attr('y', this.innerH + this.margins.bottom - 20)
			.attr('text-anchor', 'middle')
			.style('font-size', '14px')
			.style('fill', '#ffffff')
			.text('Popularity (% of games played)');

		// Y axis
		const yAxisG = this.g.axes.selectAll('.y-axis').data([0]);
		yAxisG.join('g').attr('class', 'y-axis')
			.call(d3.axisLeft(this.scales.y).tickFormat(d => this.formatPercent(d, 0)));

		this.g.axes.selectAll('.y-label').data([0]).join('text')
			.attr('class', 'y-label')
			.attr('transform', 'rotate(-90)')
			.attr('x', -this.innerH / 2)
			.attr('y', -this.margins.left + 15)
			.attr('text-anchor', 'middle')
			.style('font-size', '14px')
			.style('fill', '#ffffff')
			.text('Win rate');
	}

	#ensureGlowFilter() {
		if (!this.svg) return;
		const defs = this.svg.select('defs').empty() ? this.svg.append('defs') : this.svg.select('defs');

		if (!defs.select('#opening-glow').empty()) return;

		const filter = defs.append('filter')
			.attr('id', 'opening-glow')
			.attr('x', '-50%')
			.attr('y', '-50%')
			.attr('width', '200%')
			.attr('height', '200%');

		filter.append('feDropShadow')
			.attr('dx', 0)
			.attr('dy', 0)
			.attr('stdDeviation', 3)
			.attr('flood-color', '#7ca9ff')
			.attr('flood-opacity', 0.95);
	}

	preprocess() {
		const cadence = this.filters.time_control;
		const eloKey = this.filters.elo;
		const colorFilter = this.filters.color;

		const band = this.data?.payload?.[cadence]?.[eloKey];
		if (!Array.isArray(band)) return [];

		return band
			.filter(d => d && d.popularity !== undefined && d.win_rate !== undefined)
			.filter(d => {
				const count = Number.isFinite(d.count) ? d.count : 0;
				return count >= this._minGames;
			})
			.map(d => {
				let winRateValue;
				if (colorFilter === 1) winRateValue = d.win_rate[1];
				else if (colorFilter === 2) winRateValue = d.win_rate[2];
				else winRateValue = d.win_rate[0];

				return {
					name: d.name,
					popularity: d.popularity,
					win_rate: winRateValue,
					color: d.color,
					count: Number.isFinite(d.count) ? d.count : 0
				};
			});
	}

	bindMarks(data) {
		this.#ensureGlowFilter();

		this.g.marks.selectAll('*').remove();

		const crosses = this.g.marks.selectAll('.cross').data(data, d => d.name);

		// exit
		crosses.exit().transition().duration(150).style('opacity', 0).remove();

		// enter
		const enter = crosses.enter().append('g').attr('class', 'cross').style('opacity', 0);
		enter.append('circle').attr('class', 'bubble');

		const merged = enter.merge(crosses);

		merged.transition().duration(200).style('opacity', 1)
			.attr('transform', d => `translate(${this.scales.x(d.popularity)}, ${this.scales.y(d.win_rate)})`);

		const isSelected = (d) =>
			(this.filters.opening && this.filters.opening !== 'All' && d.name === this.filters.opening);

		const getFill = (d) => {
			if (isSelected(d)) return '#3777ffff';
			return d.color === 'black' ? '#555555' : '#ffffff';
		};

		merged.select('circle')
			.attr('fill', d => getFill(d))
			.attr('fill-opacity', d => isSelected(d) ? 0.8 : 0.5)
			.attr('r', d => isSelected(d) ? 8 : 6)
			.attr('filter', d => isSelected(d) ? 'url(#opening-glow)' : null)
			.attr('stroke', d => isSelected(d) ? '#a0c6ff' : '#eee')
			.attr('stroke-width', d => isSelected(d) ? 2 : 0.25)
			.style('cursor', 'pointer')
			.style('transition', 'fill 0.5s ease, transform 0.5s ease');

		// Hover interaction
		const color = this.filters.color === 1 ? 'White' : this.filters.color === 2 ? 'Black' : 'Both';
		merged
			.on('mouseover', (event, d) => {
				d3.select(event.currentTarget).select('circle')
					.attr('fill', '#3777ffff')
					.attr('fill-opacity', 0.8);

				d3.select(event.currentTarget)
					.attr('transform', `translate(${this.scales.x(d.popularity)}, ${this.scales.y(d.win_rate)}) scale(1.5)`);

				this.showTooltip(
					`<strong>${d.name}</strong><br>` +
					`Popularity: ${this.formatPercent(d.popularity, 2)}<br>` +
					`Win rate (${color}): ${this.formatPercent(d.win_rate, 2)}<br>` +
					`Games: ${d.count}`,
					event
				);
			})
			.on('mouseout', (event, d) => {
				d3.select(event.currentTarget).select('circle')
					.attr('fill', d => getFill(d))
					.attr('filter', isSelected(d) ? 'url(#opening-glow)' : null)
					.attr('fill-opacity', isSelected(d) ? 0.8 : 0.5);

				d3.select(event.currentTarget)
					.attr('transform', `translate(${this.scales.x(d.popularity)}, ${this.scales.y(d.win_rate)}) scale(1)`);

				this.hideTooltip();
			})
			.on('click', (event, d) => {
				const select = document.getElementById('opening');
				if (!select) return;
				const hasOption = Array.from(select.options).some((o) => o.value === d.name);
				select.value = hasOption ? d.name : 'All';
				select.dispatchEvent(new Event('change', { bubbles: true }));
			});
	}
}

export { PopularityVisualization };
