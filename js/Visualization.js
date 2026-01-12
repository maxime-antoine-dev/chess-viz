class Visualization {
	/**
	 * Constructor for Visualization base class
	 * @param {string} dataPath - URL to JSON data
	 * @param {HTMLElement} container - Container element
	 * @param {object} margins - Margins object {top, right, bottom, left}
	 */
	constructor(dataPath, container, margins) {
		this.dataPath = dataPath;
		this.container = container;
		this.margins = margins;
		this.debounceMs = 80;

		this.data = null;
		this.width = 0;
		this.height = 0;
		this.innerW = 0;
		this.innerH = 0;

		this.svg = null;
		this.root = null; // group translated by margins
		this.g = { axes: null, marks: null };
		this.tooltip = null;
		this.initialized = false;

		this.filters = {};
	}


	// === Public methods ===

	/**
	 * Initialize the visualization (load data, setup SVG, etc.)
	 * @returns {Promise<Visualization>} The initialized visualization instance
	 */
	async init() {
		// Avoid re-initialization
		if (this.initialized) return this;

		await this.loadData();
		this.measure();
		this.setupSVG();
		this.computeScales();
		this.drawAxes();

		this.initialized = true;
		return this;
	}

	/**
	 * Render or update the visualization
	 * @param {string} time_control - Time control filter
	 * @param {string} elo - ELO range filter
	 * @param {string} color - Color filter
	 * @param {string} opening - Opening filter
	 * @returns {void}
	 * @throws {Error} If not implemented in subclass
	 */
	render(time_control, elo, color, opening) {
		throw new Error('Subclasses must implement render() method');
	}


	// === Protected methods ===

	/**
	 * Draw axes for the visualization
	 * @returns {void}
	 * @throws {Error} If not implemented in subclass
	 */
	drawAxes() {
		throw new Error('Subclasses must implement drawAxes() method');
	}

	/**
	 * Compute scales for the visualization
	 * @returns {void}
	 * @throws {Error} If not implemented in subclass
	 */
	computeScales() {
		throw new Error('Subclasses must implement computeScales() method');
	}

	/**
	 * Show tooltip at mouse position
	 * @param {string} html - HTML content for the tooltip
	 * @param {MouseEvent} event - Mouse event for positioning
	 * @returns {void}
	 */
	showTooltip(html, event) {
		if (!this.tooltip) this.createTooltip();
		this.tooltip.html(html);
		const node = this.tooltip.node();
		const w = node ? node.offsetWidth : 0;
		const padding = 10;
		const minLeft = 8;
		const viewportW = window.innerWidth || document.documentElement.clientWidth;
		const cursorX = event.pageX;

		let left;
		if (cursorX > viewportW / 2) {	// tooltip on the left side
			left = cursorX - w - padding;
			left = Math.max(minLeft, left);
		} else {						// tooltip on the right side
			left = cursorX + padding;
			const maxLeft = Math.max(minLeft, viewportW - w - padding);
			left = Math.min(Math.max(minLeft, left), maxLeft);
		}
		const top = Math.max(8, event.pageY - 28);

		this.tooltip
			.style('left', left + 'px')
			.style('top', top + 'px')
			.transition()
			.duration(150)
			.style('opacity', 0.95);
	}

	/**
	 * Hide tooltip
	 * @returns {void}
	 */
	hideTooltip() {
		if (!this.tooltip) return;
		this.tooltip.transition().duration(250).style('opacity', 0);
	}

	/**
	 * Format a number as a percentage string
	 * @param {number} v - Value to format
	 * @param {number} digits - Number of decimal digits
	 * @returns {string} Formatted percentage string
	 */
	formatPercent(v, digits = 2) {
		return (v * 100).toFixed(digits) + '%';
	}

	/**
	 * Load data from the specified data path
	 * @returns {Promise<void>}
	 */
	async loadData() {
		try {
			const d = await d3.json(this.dataPath);
			this.data = d;
		} catch (err) {
			console.error('Error during data loading from path: ' + this.dataPath, err);
			this.data = null;
		}
	}

	/**
	 * Setup SVG elements
	 * @returns {void}
	 */
	setupSVG() {
		if (!this.svg) {
			this.svg = d3.select(this.container)
				.append('svg')
				.style('width', '100%')
				.style('height', '100%')
				.attr('preserveAspectRatio', 'xMidYMid meet')
				.attr('viewBox', `0 0 ${this.width} ${this.height}`);

			this.root = this.svg.append('g').attr('class', 'root')
				.attr('transform', `translate(${this.margins.left},${this.margins.top})`);

			this.g.axes = this.root.append('g').attr('class', 'axes');
			this.g.marks = this.root.append('g').attr('class', 'marks');

			this.createTooltip();
		}
	}

	/**
	 * Measure container dimensions and update width/height
	 * @returns {void}
	 */
	measure() {
		const rect = this.container.getBoundingClientRect();
		this.width = Math.max(1, Math.round(rect.width));
		this.height = Math.max(1, Math.round(rect.height));
		this.innerW = Math.max(1, this.width - this.margins.left - this.margins.right);
		this.innerH = Math.max(1, this.height - this.margins.top - this.margins.bottom);
		if (this.svg) this.svg.attr('viewBox', `0 0 ${this.width} ${this.height}`);
		if (this.root) this.root.attr('transform', `translate(${this.margins.left},${this.margins.top})`);
	}

	/**
	 * Create tooltip element
	 * @returns {void}
	 */
	createTooltip() {
		this.tooltip = d3.select("#tooltip");
	}
}

export { Visualization };
