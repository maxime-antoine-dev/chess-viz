function normalizePgnToMovetext(raw) {
	let s = (raw ?? '').toString();

	// Remove PGN tag-pairs: lines like [Event "..."]
	s = s
		.split('\n')
		.filter((line) => !line.trim().startsWith('['))
		.join(' ');

	// Strip comments / variations / nags
	s = s.replace(/\{[^}]*\}/g, ' ');
	s = s.replace(/\([^)]*\)/g, ' ');
	s = s.replace(/\$\d+/g, ' ');

	// Remove move numbers like "1." and "1..." and "1.."
	s = s.replace(/\b\d+\.(\.\.)?\b/g, ' ');
	s = s.replace(/\b\d+\.\.\.\b/g, ' ');

	// Remove results and trailing "*"
	s = s.replace(/\b(1-0|0-1|1\/2-1\/2|\*)\b/g, ' ');

	// Collapse whitespace
	s = s.replace(/\s+/g, ' ').trim();

	return s;
}

class OpeningExplorerState extends EventTarget {
	constructor() {
		super();
		this._pgn = '';
	}

	getPGN() {
		return this._pgn;
	}

	setPGN(pgn, meta = {}) {
		const next = normalizePgnToMovetext(pgn);
		if (next === this._pgn) return;

		this._pgn = next;
		this.dispatchEvent(
			new CustomEvent('pgnchange', {
				detail: { pgn: this._pgn, source: meta.source ?? 'unknown' },
			})
		);
	}

	onPGNChange(handler) {
		const wrapped = (e) => handler(e.detail);
		this.addEventListener('pgnchange', wrapped);
		return () => this.removeEventListener('pgnchange', wrapped);
	}
}

export const openingExplorerState = new OpeningExplorerState();
