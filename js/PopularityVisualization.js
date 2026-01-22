
import { Visualization } from './Visualization.js';

/**
 * Visualization: Opening popularity vs win rate
 * X axis: popularity (% of games)
 * Y axis: win rate
 */
class PopularityVisualization extends Visualization {

	/**
	 * @param {string} dataPath - Path to the data file
	 * @param {HTMLElement} container - DOM element containing the SVG
	 */
	constructor(dataPath, container) {
		// Call parent constructor with custom margins
		super(dataPath, container, { top: 30, right: 30, bottom: 60, left: 60 });
		this.crossSize = 3;
		this.scales = { x: null, y: null };

		// Minimum number of games required to display an opening
		this._minGames = 15;
	}

	/**
	 * Main render method, called when filters change
	 */
	render(time_control, elo, color, opening) {
		this.init().then(() => {
			// Update filters
			this.filters.time_control = time_control;
			this.filters.elo = elo;
			this.filters.color = Number.parseInt(color);
			this.filters.opening = opening;

			// Prepare filtered data
			const filtered = this.preprocess();

			// Draw / update points
			this.bindMarks(filtered);
		}).catch(err => console.error(err));
	}


	/**
	 * Compute X and Y scales using all valid data
	 */
	computeScales() {
		const payload = this.data.payload;

		let maxPop = -Infinity;
		let minWin = Infinity;
		let maxWin = -Infinity;

		// Iterate over all time controls and ELO ranges
		for (const cadenceKey in payload) {
			const cadence = payload[cadenceKey];
			for (const eloKey in cadence) {
				const band = cadence[eloKey];
				for (const d of band) {

					// Ignore openings with too few games
					const count = Number.isFinite(d.count) ? d.count : 0;
					if (count < this._minGames) continue;

					// Max popularity
					maxPop = Math.max(maxPop, d.popularity);

					// Min / max win rates (white and black)
					const winRate = d.win_rate;
					minWin = Math.min(minWin, winRate[1], winRate[2]);
					maxWin = Math.max(maxWin, winRate[1], winRate[2]);
				}
			}
		}

		if (!Number.isFinite(maxPop) || maxPop <= 0) maxPop = 1;
		if (!Number.isFinite(minWin) || !Number.isFinite(maxWin) || minWin >= maxWin) {
			minWin = 0;
			maxWin = 1;
		}

		// X scale: popularity
		this.scales.x = d3.scaleLinear()
			.domain([0, maxPop])
			.range([0, this.innerW]);

		// Y scale: win rate
		this.scales.y = d3.scaleLinear()
			.domain([minWin, maxWin])
			.range([this.innerH, 0]);
	}

	/**
	 * Draw X and Y axes and their labels
	 */
	drawAxes() {
		// X axis (popularity)
		const xAxisG = this.g.axes.selectAll('.x-axis').data([0]);
		xAxisG.join('g')
			.attr('class', 'x-axis')
			.attr('transform', `translate(0, ${this.innerH})`)
			.call(d3.axisBottom(this.scales.x)
				.tickFormat(d => this.formatPercent(d, 0)));

		// X axis label
		this.g.axes.selectAll('.x-label').data([0]).join('text')
			.attr('class', 'x-label')
			.attr('x', this.innerW / 2)
			.attr('y', this.innerH + this.margins.bottom - 20)
			.attr('text-anchor', 'middle')
			.style('font-size', '14px')
			.style('fill', '#ffffff')
			.text('Popularity (% of games played)');

		// Y axis (win rate)
		const yAxisG = this.g.axes.selectAll('.y-axis').data([0]);
		yAxisG.join('g')
			.attr('class', 'y-axis')
			.call(d3.axisLeft(this.scales.y)
				.tickFormat(d => this.formatPercent(d, 0)));

		// Y axis label
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

	/**
	 * Create a glow SVG filter for the selected opening
	 */
	#ensureGlowFilter() {
		if (!this.svg) return;

		const defs = this.svg.select('defs').empty()
			? this.svg.append('defs')
			: this.svg.select('defs');

		// Do not recreate the filter if it already exists
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

	/**
	 * Filter and transform data based on active filters
	 */
	preprocess() {
		const cadence = this.filters.time_control;
		const eloKey = this.filters.elo;
		const colorFilter = this.filters.color;

		const band = this.data?.payload?.[cadence]?.[eloKey];
		if (!Array.isArray(band)) return [];

		return band
			// Keep valid entries only
			.filter(d => d && d.popularity !== undefined && d.win_rate !== undefined)

			// Apply minimum games threshold
			.filter(d => {
				const count = Number.isFinite(d.count) ? d.count : 0;
				return count >= this._minGames;
			})

			// Select win rate depending on color
			.map(d => {
				let winRateValue;
				if (colorFilter === 1) winRateValue = d.win_rate[1];      // White
				else if (colorFilter === 2) winRateValue = d.win_rate[2]; // Black
				else winRateValue = d.win_rate[0];                        // Both

				return {
					name: d.name,
					popularity: d.popularity,
					win_rate: winRateValue,
					color: d.color,
					count: Number.isFinite(d.count) ? d.count : 0
				};
			});
	}

	/**
	 * Create, update and handle interactions for points
	 */
	bindMarks(data) {
		this.#ensureGlowFilter();

		// Clear previous marks
		this.g.marks.selectAll('*').remove();

		const crosses = this.g.marks
			.selectAll('.cross')
			.data(data, d => d.name);

		// Remove old points
		crosses.exit()
			.transition()
			.duration(150)
			.style('opacity', 0)
			.remove();

		// Create new points
		const enter = crosses.enter()
			.append('g')
			.attr('class', 'cross')
			.style('opacity', 0);

		enter.append('circle').attr('class', 'bubble');

		const merged = enter.merge(crosses);

		
		merged.transition()
			.duration(200)
			.style('opacity', 1)
			.attr('transform', d =>
				`translate(${this.scales.x(d.popularity)}, ${this.scales.y(d.win_rate)})`
			);

		// Check if opening is selected
		const isSelected = d =>
			this.filters.opening &&
			this.filters.opening !== 'All' &&
			d.name === this.filters.opening;

		// Fill color logic
		const getFill = d => {
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
			.style('cursor', 'pointer');

		// Interactions (hover and click)
		const color = this.filters.color === 1 ? 'White' :
					  this.filters.color === 2 ? 'Black' : 'Both';

		merged
			.on('mouseover', (event, d) => {
				d3.select(event.currentTarget).select('circle')
					.attr('fill', '#3777ffff')
					.attr('fill-opacity', 0.8);

				d3.select(event.currentTarget)
					.attr('transform',
						`translate(${this.scales.x(d.popularity)}, ${this.scales.y(d.win_rate)}) scale(1.5)`
					);

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
					.attr('transform',
						`translate(${this.scales.x(d.popularity)}, ${this.scales.y(d.win_rate)}) scale(1)`
					);

				this.hideTooltip();
			})
			.on('click', (event, d) => {
				// Select opening via the dropdown
				const select = document.getElementById('opening');
				if (!select) return;

				const hasOption = Array.from(select.options)
					.some(o => o.value === d.name);

				select.value = hasOption ? d.name : 'All';
				select.dispatchEvent(new Event('change', { bubbles: true }));
			});
	}
}

// Export class
export { PopularityVisualization };
