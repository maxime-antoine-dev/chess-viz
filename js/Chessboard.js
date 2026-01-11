const DEFAULT_CHESS_JS_ESM_URL = 'https://unpkg.com/chess.js@1.4.0/dist/esm/chess.js';

const PIECE_IMG_BASE_URL = 'img/pieces/';

const PIECE_IMAGES = {
	w: {
		k: `${PIECE_IMG_BASE_URL}wk.png`,
		q: `${PIECE_IMG_BASE_URL}wq.png`,
		r: `${PIECE_IMG_BASE_URL}wr.png`,
		b: `${PIECE_IMG_BASE_URL}wb.png`,
		n: `${PIECE_IMG_BASE_URL}wn.png`,
		p: `${PIECE_IMG_BASE_URL}wp.png`,
	},
	b: {
		k: `${PIECE_IMG_BASE_URL}bk.png`,
		q: `${PIECE_IMG_BASE_URL}bq.png`,
		r: `${PIECE_IMG_BASE_URL}br.png`,
		b: `${PIECE_IMG_BASE_URL}bb.png`,
		n: `${PIECE_IMG_BASE_URL}bn.png`,
		p: `${PIECE_IMG_BASE_URL}bp.png`,
	},
};

// Optional fallback if an image is missing
const PIECES_FALLBACK = {
	w: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
	b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' },
};

class ChessboardWidget {
	/**
	 * @param {{
	 *  store: { getPGN: () => string, setPGN: (pgn: string, meta?: any) => void, onPGNChange: (cb: any) => () => void },
	 *  chessJsUrl?: string
	 * }} opts
	 */
	constructor(opts) {
		if (!opts?.store) throw new Error('ChessboardWidget: "store" is required');

		this.store = opts.store;
		this.chessJsUrl = opts.chessJsUrl ?? DEFAULT_CHESS_JS_ESM_URL;

		this._Chess = null;
		this._game = null;

		this._orientation = 'white';
		this._selectedFrom = null;
		this._legalTargets = new Set();
		this._lastMove = null;

		this._ui = null;
		this._unsub = null;

		this._applyingFromBoard = false;
	}

	/**
	 * @param {{ boardEl: HTMLElement, statusEl: HTMLElement, messageEl: HTMLElement }} els
	 */
	async mount(els) {
		if (!els?.boardEl) {
			throw new Error('ChessboardWidget.mount: boardEl are required');
		}
		this._ui = els;

		await this.#ensureChessLoaded();
		this._game = new this._Chess();

		this._unsub = this.store.onPGNChange(({ pgn, source }) => {
			if (this._applyingFromBoard && source === 'board') return;
			this.#applyPGNToGame(pgn ?? '', source);
		});

		this.#applyPGNToGame(this.store.getPGN() ?? '', 'init');
	}

	destroy() {
		if (this._unsub) this._unsub();
		this._unsub = null;
		this._ui = null;
	}

	flip() {
		this._orientation = this._orientation === 'white' ? 'black' : 'white';
		this.#clearSelection();
		this.#renderBoard();
	}

	setOrientation(orientation) {
		if (orientation !== 'white' && orientation !== 'black') return;
		if (this._orientation === orientation) return;
		this._orientation = orientation;
		this.#clearSelection();
		this.#renderBoard();
	}

	getOrientation() {
		return this._orientation;
	}

	// Chess.js loading / PGN sync

	static _chessModulePromise = null;

	async #ensureChessLoaded() {
		if (this._Chess) return;

		if (!ChessboardWidget._chessModulePromise) {
			ChessboardWidget._chessModulePromise = import(this.chessJsUrl);
		}

		const mod = await ChessboardWidget._chessModulePromise;
		this._Chess = mod?.Chess;
		if (!this._Chess) throw new Error('ChessboardWidget: failed to load chess.js Chess class');
	}

	#applyPGNToGame(pgn, source) {
		if (!this._game) return;

		if (!pgn.trim()) {
			this._game.reset();
			this._lastMove = null;
			this.#clearSelection();
			this.#renderBoard();
			this.#renderStatus();
			return;
		}

		const next = new this._Chess();
		this._game = next;
		this._lastMove = null;
		this.#clearSelection();
		this.#renderBoard();
		this.#renderStatus();
	}

	#commitBoardToStore() {
		let pgn = '';
		try {
			// chess.js returns movetext (headers only if you set them)
			pgn = this._game.pgn();
		} catch {
			pgn = '';
		}

		this._applyingFromBoard = true;
		this.store.setPGN(pgn, { source: 'board' });
		this._applyingFromBoard = false;
	}

	// Rendering & interactions

	#getPieceImageSrc(piece) {
		return PIECE_IMAGES?.[piece?.color]?.[piece?.type] ?? '';
	}

	#renderBoard() {
		if (!this._ui?.boardEl || !this._game) return;

		const boardEl = this._ui.boardEl;
		boardEl.innerHTML = '';

		const squares = this.#orderedSquares();
		for (const sq of squares) {
			const cell = document.createElement('div');
			cell.className = `cbw-square ${this.#isLightSquare(sq) ? 'cbw-light' : 'cbw-dark'}`;
			cell.dataset.square = sq;

			const piece = this._game.get(sq);
			if (piece) {
				const src = this.#getPieceImageSrc(piece);

				if (src) {
					const img = document.createElement('img');
					img.className = 'cbw-piece';
					img.src = src;
					img.alt = `${piece.color}${piece.type}`;
					img.draggable = false;
					img.style.pointerEvents = 'none';
					cell.appendChild(img);
				} else {
					cell.textContent = PIECES_FALLBACK[piece.color]?.[piece.type] ?? '';
				}
			}

			if (this._selectedFrom === sq) cell.classList.add('cbw-selected');
			if (this._legalTargets.has(sq)) cell.classList.add('cbw-legal');
			if (this._lastMove && (this._lastMove.from === sq || this._lastMove.to === sq)) cell.classList.add('cbw-last');

			cell.addEventListener('click', () => this.#onSquareClick(sq));
			boardEl.appendChild(cell);
		}
	}

	#onSquareClick(square) {
		const piece = this._game.get(square);
		const turn = this._game.turn(); // 'w' | 'b'

		if (!this._selectedFrom) {
			if (piece && piece.color === turn) {
				this._selectedFrom = square;
				this.#computeLegals(square);
				this.#renderBoard();
			}
			return;
		}

		if (this._selectedFrom === square) {
			this.#clearSelection();
			this.#renderBoard();
			return;
		}

		const from = this._selectedFrom;
		const to = square;

		if (piece && piece.color === turn) {
			this._selectedFrom = square;
			this.#computeLegals(square);
			this.#renderBoard();
			return;
		}

		const move = this._game.move({ from, to, promotion: 'q' });
		if (!move) {
			this.#computeLegals(from);
			this.#renderBoard();
			return;
		}

		this._lastMove = { from: move.from, to: move.to };
		this.#clearSelection();
		this.#renderBoard();
		this.#renderStatus();
		this.#commitBoardToStore();
	}

	#computeLegals(fromSquare) {
		this._legalTargets.clear();
		try {
			const moves = this._game.moves({ square: fromSquare, verbose: true }) || [];
			for (const m of moves) this._legalTargets.add(m.to);
		} catch {
			// ignore
		}
	}

	#clearSelection() {
		this._selectedFrom = null;
		this._legalTargets.clear();
	}

	#renderStatus() {
		if (!this._ui?.statusEl || !this._game) return;

		const turn = this._game.turn() === 'w' ? 'White' : 'Black';
		let extra = '';

		try {
			if (this._game.isCheckmate?.()) extra = ' — Checkmate';
			else if (this._game.isStalemate?.()) extra = ' — Stalemate';
			else if (this._game.isDraw?.()) extra = ' — Draw';
			else if (this._game.isCheck?.()) extra = ' — Check';
		} catch {
			// ignore
		}

		this._ui.statusEl.textContent = `Turn: ${turn}${extra}`;
	}

	#orderedSquares() {
		const files = this._orientation === 'white'
			? ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
			: ['h', 'g', 'f', 'e', 'd', 'c', 'b', 'a'];

		const ranks = this._orientation === 'white'
			? ['8', '7', '6', '5', '4', '3', '2', '1']
			: ['1', '2', '3', '4', '5', '6', '7', '8'];

		const out = [];
		for (const r of ranks) for (const f of files) out.push(`${f}${r}`);
		return out;
	}

	#isLightSquare(square) {
		const file = square.codePointAt(0) - 'a'.codePointAt(0);
		const rank = Number.parseInt(square[1], 10) - 1;
		return (file + rank) % 2 === 0;
	}
}

export { ChessboardWidget };
