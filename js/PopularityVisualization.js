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
		const color = this.filters.color;

		const band = this.data?.payload?.[cadence]?.[eloKey];
		if (!Array.isArray(band)) return [];

		return band.filter(d => d && d.popularity !== undefined && d.win_rate !== undefined)
			.map(d => ({ name: d.name, popularity: d.popularity, win_rate: d.win_rate[color] }));
	}

	bindMarks(data) {
		this.#ensureGlowFilter();

		this.g.marks.selectAll('*').remove();

		const crosses = this.g.marks.selectAll('.cross').data(data, d => d.name);
		crosses.exit().transition().duration(150).style('opacity', 0).remove();

		const enter = crosses.enter().append('g').attr('class', 'cross').style('opacity', 0);
		enter.append('circle').attr('class', 'bubble');

		const merged = enter.merge(crosses);

		merged.transition().duration(200).style('opacity', 1)
			.attr('transform', d => `translate(${this.scales.x(d.popularity)}, ${this.scales.y(d.win_rate)})`);

		const isSelected = (d) =>
			(this.filters.opening && this.filters.opening !== 'All' && d.name === this.filters.opening);

		merged.select('circle')
			.attr('fill', d => isSelected(d) ? '#3777ffff' : 'white')
			.attr('fill-opacity', d => isSelected(d) ? 0.8 : 0.5)
			.attr('r', d => isSelected(d) ? 8 : 6)
			.attr('filter', d => isSelected(d) ? 'url(#opening-glow)' : null)
			.attr('stroke', d => isSelected(d) ? '#a0c6ff' : 'none')
			.attr('stroke-width', d => isSelected(d) ? 2 : 0)
			.style('cursor', 'pointer')
			.style('transition', 'fill 0.5s ease, transform 0.5s ease');

		const colorLabel = this.filters.color === 1 ? 'White' : this.filters.color === 2 ? 'Black' : 'Both';
		merged
			.on('mouseover', (event, d) => {
				d3.select(event.currentTarget).select('circle')
					.attr('fill', '#3777ffff')
					.attr('fill-opacity', 0.8);

				d3.select(event.currentTarget)
					.attr('transform', `translate(${this.scales.x(d.popularity)}, ${this.scales.y(d.win_rate)}) scale(1.5)`);

				this.showTooltip(
					`<strong>${d.name}</strong><br>Popularity: ${this.formatPercent(d.popularity, 2)}<br>Win rate (${colorLabel}): ${this.formatPercent(d.win_rate, 2)}`,
					event
				);
			})
			.on('mouseout', (event, d) => {
				d3.select(event.currentTarget).select('circle')
					.attr('fill', isSelected(d) ? '#3777ffff' : 'white')
					.attr('filter', isSelected(d) ? 'url(#opening-glow)' : null)
					.attr('fill-opacity', isSelected(d) ? 0.8 : 0.5);

				d3.select(event.currentTarget)
					.attr('transform', `translate(${this.scales.x(d.popularity)}, ${this.scales.y(d.win_rate)}) scale(1)`);

				this.hideTooltip();
			})
			.on('click', (event, d) => {
				if (typeof window !== "undefined" && typeof window.setExplorerFilters === "function") {
					window.setExplorerFilters({ opening: d.name }, { source: "popularity_click", setBasePGN: true });
					return;
				}

				// fallback old behavior
				const select = document.getElementById('opening');
				if (!select) return;
				const hasOption = Array.from(select.options).some((o) => o.value === d.name);
				select.value = hasOption ? d.name : 'All';
				select.dispatchEvent(new Event('change', { bubbles: true }));
			});
	}
}

export { PopularityVisualization };