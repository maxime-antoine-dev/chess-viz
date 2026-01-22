// Import de la classe de base pour toutes les visualisations
import { Visualization } from './Visualization.js';

/**
 * Visualisation : Popularité vs taux de victoire des ouvertures
 * Axe X : popularité (% de parties jouées)
 * Axe Y : win rate
 */
class PopularityVisualization extends Visualization {

	/**
	 * @param {string} dataPath - Chemin vers le fichier de données
	 * @param {HTMLElement} container - Élément DOM contenant le SVG
	 */
	constructor(dataPath, container) {
		// Appel du constructeur parent avec marges personnalisées
		super(dataPath, container, { top: 30, right: 30, bottom: 60, left: 60 });

		// Taille de référence (héritage / usage futur)
		this.crossSize = 3;

		// Échelles D3 (initialisées plus tard)
		this.scales = { x: null, y: null };

		// Seuil minimum de parties pour afficher une ouverture
		
		this._minGames = 15;
	}

	/**
	 * Méthode principale appelée lors d’un changement de filtre
	 */
	render(time_control, elo, color, opening) {
		this.init().then(() => {
			// Mise à jour des filtres
			this.filters.time_control = time_control;
			this.filters.elo = elo;
			this.filters.color = Number.parseInt(color);
			this.filters.opening = opening;

			// Prétraitement des données
			const filtered = this.preprocess();

			// Affichage / mise à jour des points
			this.bindMarks(filtered);
		}).catch(err => console.error(err));
	}

	// ============================
	// Méthodes internes
	// ============================

	/**
	 * Calcule les échelles X et Y à partir de toutes les données valides
	 */
	computeScales() {
		const payload = this.data.payload;

		let maxPop = -Infinity;
		let minWin = Infinity;
		let maxWin = -Infinity;

		// Parcours de toutes les cadences et tranches ELO
		for (const cadenceKey in payload) {
			const cadence = payload[cadenceKey];
			for (const eloKey in cadence) {
				const band = cadence[eloKey];
				for (const d of band) {

					// Ignorer les ouvertures avec trop peu de parties
					const count = Number.isFinite(d.count) ? d.count : 0;
					if (count < this._minGames) continue;

					// Popularité maximale
					maxPop = Math.max(maxPop, d.popularity);

					// Min / max des taux de victoire (blancs et noirs)
					const winRate = d.win_rate;
					minWin = Math.min(minWin, winRate[1], winRate[2]);
					maxWin = Math.max(maxWin, winRate[1], winRate[2]);
				}
			}
		}

		// Gestion des cas limites (données absentes ou invalides)
		if (!Number.isFinite(maxPop) || maxPop <= 0) maxPop = 1;
		if (!Number.isFinite(minWin) || !Number.isFinite(maxWin) || minWin >= maxWin) {
			minWin = 0;
			maxWin = 1;
		}

		// Échelle X : popularité
		this.scales.x = d3.scaleLinear()
			.domain([0, maxPop])
			.range([0, this.innerW]);

		// Échelle Y : win rate
		this.scales.y = d3.scaleLinear()
			.domain([minWin, maxWin])
			.range([this.innerH, 0]);
	}

	/**
	 * Dessin des axes X et Y + leurs labels
	 */
	drawAxes() {
		// Axe X (popularité)
		const xAxisG = this.g.axes.selectAll('.x-axis').data([0]);
		xAxisG.join('g')
			.attr('class', 'x-axis')
			.attr('transform', `translate(0, ${this.innerH})`)
			.call(d3.axisBottom(this.scales.x)
				.tickFormat(d => this.formatPercent(d, 0)));

		// Label axe X
		this.g.axes.selectAll('.x-label').data([0]).join('text')
			.attr('class', 'x-label')
			.attr('x', this.innerW / 2)
			.attr('y', this.innerH + this.margins.bottom - 20)
			.attr('text-anchor', 'middle')
			.style('font-size', '14px')
			.style('fill', '#ffffff')
			.text('Popularity (% of games played)');

		// Axe Y (win rate)
		const yAxisG = this.g.axes.selectAll('.y-axis').data([0]);
		yAxisG.join('g')
			.attr('class', 'y-axis')
			.call(d3.axisLeft(this.scales.y)
				.tickFormat(d => this.formatPercent(d, 0)));

		// Label axe Y
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
	 * Ajoute un filtre SVG pour un halo lumineux
	 * utilisé sur l’ouverture sélectionnée
	 */
	#ensureGlowFilter() {
		if (!this.svg) return;

		const defs = this.svg.select('defs').empty()
			? this.svg.append('defs')
			: this.svg.select('defs');

		// Ne pas recréer le filtre s’il existe déjà
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
	 * Filtrage et transformation des données selon les filtres actifs
	 */
	preprocess() {
		const cadence = this.filters.time_control;
		const eloKey = this.filters.elo;
		const colorFilter = this.filters.color;

		const band = this.data?.payload?.[cadence]?.[eloKey];
		if (!Array.isArray(band)) return [];

		return band
			// Données valides uniquement
			.filter(d => d && d.popularity !== undefined && d.win_rate !== undefined)

			// Seuil minimum de parties
			.filter(d => {
				const count = Number.isFinite(d.count) ? d.count : 0;
				return count >= this._minGames;
			})

			// Sélection du win rate selon la couleur
			.map(d => {
				let winRateValue;
				if (colorFilter === 1) winRateValue = d.win_rate[1];      // Blancs
				else if (colorFilter === 2) winRateValue = d.win_rate[2]; // Noirs
				else winRateValue = d.win_rate[0];                        // Global

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
	 * Création, mise à jour et interaction des cercles
	 */
	bindMarks(data) {
		this.#ensureGlowFilter();

		// Nettoyage complet avant redraw
		this.g.marks.selectAll('*').remove();

		const crosses = this.g.marks
			.selectAll('.cross')
			.data(data, d => d.name);

		// Suppression des points obsolètes
		crosses.exit()
			.transition()
			.duration(150)
			.style('opacity', 0)
			.remove();

		// Création des nouveaux points
		const enter = crosses.enter()
			.append('g')
			.attr('class', 'cross')
			.style('opacity', 0);

		enter.append('circle').attr('class', 'bubble');

		const merged = enter.merge(crosses);

		// Positionnement des points
		merged.transition()
			.duration(200)
			.style('opacity', 1)
			.attr('transform', d =>
				`translate(${this.scales.x(d.popularity)}, ${this.scales.y(d.win_rate)})`
			);

		// Vérifie si l’ouverture est sélectionnée
		const isSelected = d =>
			this.filters.opening &&
			this.filters.opening !== 'All' &&
			d.name === this.filters.opening;

		// Couleur de remplissage selon sélection et couleur d’ouverture
		const getFill = d => {
			if (isSelected(d)) return '#3777ffff';
			return d.color === 'black' ? '#555555' : '#ffffff';
		};

		// Style des cercles
		merged.select('circle')
			.attr('fill', d => getFill(d))
			.attr('fill-opacity', d => isSelected(d) ? 0.8 : 0.5)
			.attr('r', d => isSelected(d) ? 8 : 6)
			.attr('filter', d => isSelected(d) ? 'url(#opening-glow)' : null)
			.attr('stroke', d => isSelected(d) ? '#a0c6ff' : '#eee')
			.attr('stroke-width', d => isSelected(d) ? 2 : 0.25)
			.style('cursor', 'pointer')
			.style('transition', 'fill 0.5s ease, transform 0.5s ease');

		// Interactions (hover + click)
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
				// Sélection de l’ouverture via le <select>
				const select = document.getElementById('opening');
				if (!select) return;

				const hasOption = Array.from(select.options)
					.some(o => o.value === d.name);

				select.value = hasOption ? d.name : 'All';
				select.dispatchEvent(new Event('change', { bubbles: true }));
			});
	}
}

// Export de la classe
export { PopularityVisualization };
