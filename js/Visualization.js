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

		this.filters = {
			time_control: 'rapid',
			elo: '0_500'
		};

		this._ro = null;
	}

	/**
	 * Initialize the visualization (load data, setup SVG, etc.)
	 * @returns {void}
	 */
	async init() {
		// Avoid re-initialization
		if (this.initialized) return this;

		// normalize container element
		const containerEl = (typeof this.container === 'string') ? document.querySelector(this.container) : this.container;
		if (!containerEl) throw new Error('Container element not found');
		this.container = containerEl;

		// Attempt to load data first so renderers can rely on `this.data` synchronously after init
		try {
			const d = await d3.json(this.dataPath);
			this.data = d;
		} catch (err) {
			console.error('Error during data loading from path: ' + this.dataPath, err);
			this.data = null;
		}

		// Measure and setup SVG
		this._measure();
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

			this._createTooltip();
		}

		// this._installResizeObserver();

		this.initialized = true;
		return this;
	}

	/**
	 * Render or update the visualization
	 * @param {string} time_control - Time control filter
	 * @param {string} elo - ELO range filter
	 * @returns {void}
	 * @throws {Error} If not implemented in subclass
	 */
	render(time_control, elo) {
		throw new Error('Subclasses must implement render() method');
	}


	// === Utility methods ===

	// measure container and compute inner sizes
	_measure() {
		const rect = this.container.getBoundingClientRect();
		this.width = Math.max(1, Math.round(rect.width));
		this.height = Math.max(1, Math.round(rect.height));
		this.innerW = Math.max(1, this.width - this.margins.left - this.margins.right);
		this.innerH = Math.max(1, this.height - this.margins.top - this.margins.bottom);
		if (this.svg) this.svg.attr('viewBox', `0 0 ${this.width} ${this.height}`);
		if (this.root) this.root.attr('transform', `translate(${this.margins.left},${this.margins.top})`);
	}

	_installResizeObserver() {
		const measureAndRender = () => { this._measure(); this.render(); };
		const debounced = (() => { let t; return () => { clearTimeout(t); t = setTimeout(measureAndRender, this.options.debounceMs); }; })();

		if (this._ro) return; // already installed
		if (typeof ResizeObserver !== 'undefined') {
			this._ro = new ResizeObserver(debounced);
			this._ro.observe(this.container);
		} else {
			window.addEventListener('resize', debounced);
		}
	}

	_createTooltip() {
		if (this.tooltip) return;

		this.tooltip = d3.select('body').append('div')
			.attr('id', 'tooltip')
	}

	showTooltip(html, event) {
		if (!this.tooltip) this._createTooltip();
		this.tooltip.transition().duration(150).style('opacity', 0.95);
		this.tooltip.html(html)
			.style('left', (event.pageX + 10) + 'px')
			.style('top', (event.pageY - 28) + 'px');
	}

	hideTooltip() {
		if (!this.tooltip) return;
		this.tooltip.transition().duration(250).style('opacity', 0);
	}

	formatPercent(v, digits = 2) { return (v * 100).toFixed(digits) + '%'; }
}

export { Visualization };
