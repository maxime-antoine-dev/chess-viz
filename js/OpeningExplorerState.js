function normalizePgnToMovetext(raw) {
	const s = (raw ?? '').toString();

	// Remove PGN tag-pairs: lines like [Event "..."]
	const withoutTags = s
		.split('\n')
		.filter((line) => !line.trim().startsWith('['))
		.join('\n');

	// Collapse whitespace/newlines to a single space (simple + stable)
	return withoutTags.replace(/\s+/g, ' ').trim();
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
