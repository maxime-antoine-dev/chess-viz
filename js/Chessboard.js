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

		// layers + piece map (smooth movement)
		this._squaresLayer = null;
		this._piecesLayer = null;
		this._pieceElsBySquare = new Map(); // square -> element (img/span)

		// ✅ new: external PGN animation control
		this._pgnAnimToken = 0;
		this._isAnimating = false;
	}

	async mount(els) {
		if (!els?.boardEl) throw new Error('ChessboardWidget.mount: boardEl are required');
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
		this.#renderBoard(false);
	}

	setOrientation(orientation) {
		if (orientation !== 'white' && orientation !== 'black') return;
		if (this._orientation === orientation) return;
		this._orientation = orientation;
		this.#clearSelection();
		this.#renderBoard(false);
	}

	getOrientation() {
		return this._orientation;
	}

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

	#hasResultToken(s) {
		const t = (s ?? '').trim();
		return /\b(1-0|0-1|1\/2-1\/2|\*)\s*$/.test(t);
	}

	#tryLoadPgn(game, raw) {
		const pgn = (raw ?? '').trim();
		if (!pgn) return true;

		const pgnWithResult = this.#hasResultToken(pgn) ? pgn : `${pgn} *`;
		const opts = { sloppy: true };

		if (typeof game.loadPgn === 'function') return !!game.loadPgn(pgnWithResult, opts);
		if (typeof game.load_pgn === 'function') return !!game.load_pgn(pgnWithResult, opts);
		return false;
	}

	#tokenizeMovetextToSans(raw) {
		let s = (raw ?? '').toString();

		s = s
			.split('\n')
			.filter((line) => !line.trim().startsWith('['))
			.join(' ');

		s = s.replace(/\{[^}]*\}/g, ' ');
		s = s.replace(/\([^)]*\)/g, ' ');
		s = s.replace(/\$\d+/g, ' ');

		s = s.replace(/\s+/g, ' ').trim();
		if (!s) return [];

		const tokens = s.split(' ').map((x) => x.trim()).filter(Boolean);

		return tokens.filter((tok) => {
			if (/^\d+\.(\.\.)?$/.test(tok)) return false;
			if (/^\d+\.\.\.$/.test(tok)) return false;
			if (/^\d+\.$/.test(tok)) return false;
			if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(tok)) return false;
			return true;
		});
	}

	#tryApplySanSequence(game, raw) {
		const sans = this.#tokenizeMovetextToSans(raw);
		if (!sans.length) return true;

		for (const san of sans) {
			const mv = game.move(san, { sloppy: true });
			if (!mv) return false;
		}
		return true;
	}

	#recomputeLastMoveFromHistory() {
		this._lastMove = null;
		try {
			const hist = this._game.history?.({ verbose: true }) ?? [];
			const last = hist[hist.length - 1];
			if (last?.from && last?.to) this._lastMove = { from: last.from, to: last.to };
		} catch {}
	}

	// smooth external PGN apply (sunburst/select): replay SAN from start quickly
	async #animateToSanSequence(sans, animToken) {
		if (!this._Chess) return;
		this._isAnimating = true;

		// start from initial position
		this._game = new this._Chess();
		this._lastMove = null;
		this.#clearSelection();
		this.#renderBoard(false);
		this.#renderStatus();

		if (!sans.length) {
			this._isAnimating = false;
			return;
		}

		// keep total duration reasonable
		const maxTotalMs = 1200;
		const stepMs = Math.min(140, Math.max(35, Math.floor(maxTotalMs / sans.length)));

		for (const san of sans) {
			if (animToken !== this._pgnAnimToken) {
				this._isAnimating = false;
				return; // cancelled by a new PGN update
			}

			const mv = this._game.move(san, { sloppy: true });
			if (!mv) break;

			this._lastMove = { from: mv.from, to: mv.to };
			this.#clearSelection();
			this.#renderBoard(true);
			this.#renderStatus();

			// wait a bit between steps
			// eslint-disable-next-line no-await-in-loop
			await new Promise((r) => setTimeout(r, stepMs));
		}

		if (animToken === this._pgnAnimToken) {
			this.#recomputeLastMoveFromHistory();
			this.#clearSelection();
			this.#renderBoard(false);
			this.#renderStatus();
		}

		this._isAnimating = false;
	}

	#applyPGNToGame(pgn, source) {
		if (!this._Chess) return;

		// cancel any ongoing animation
		this._pgnAnimToken += 1;
		const myToken = this._pgnAnimToken;

		const trimmed = (pgn ?? '').trim();

		// reset: instant
		if (!trimmed) {
			this._isAnimating = false;
			this._game = new this._Chess();
			this._lastMove = null;
			this.#clearSelection();
			this.#renderBoard(false);
			this.#renderStatus();
			return;
		}

		// validate / normalize by trying to build final position
		const next = new this._Chess();
		let ok = this.#tryLoadPgn(next, trimmed);

		if (!ok) {
			next.reset();
			ok = this.#tryApplySanSequence(next, trimmed);
		}

		if (!ok) return;

		// If PGN comes from outside the board, animate it (sunburst/select/etc)
		const shouldAnimateExternal =
			source !== 'board' && source !== 'init' && source !== 'reset' && source !== 'flip';

		if (shouldAnimateExternal) {
			const sans = this.#tokenizeMovetextToSans(trimmed);
			// play from start; super stable and always animates nicely
			this.#animateToSanSequence(sans, myToken);
			return;
		}

		// board-driven or init: apply instantly (board moves are already animated in #onSquareClick)
		this._isAnimating = false;
		this._game = next;
		this.#recomputeLastMoveFromHistory();
		this.#clearSelection();
		this.#renderBoard(false);
		this.#renderStatus();
	}

	#commitBoardToStore() {
		let pgn = '';
		try {
			pgn = this._game.pgn();
		} catch {
			pgn = '';
		}

		this._applyingFromBoard = true;
		this.store.setPGN(pgn, { source: 'board' });
		this._applyingFromBoard = false;
	}

	#getPieceImageSrc(piece) {
		return PIECE_IMAGES?.[piece?.color]?.[piece?.type] ?? '';
	}

	#ensureBoardLayers() {
		if (!this._ui?.boardEl) return;

		const boardEl = this._ui.boardEl;

		if (this._squaresLayer && this._piecesLayer) return;

		boardEl.innerHTML = '';

		const squares = document.createElement('div');
		squares.className = 'cbw-squares-layer';

		const pieces = document.createElement('div');
		pieces.className = 'cbw-pieces-layer';

		boardEl.appendChild(squares);
		boardEl.appendChild(pieces);

		this._squaresLayer = squares;
		this._piecesLayer = pieces;
	}

	#allSquares() {
		const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
		const out = [];
		for (let r = 1; r <= 8; r++) for (const f of files) out.push(`${f}${r}`);
		return out;
	}

	#squareToGridXY(square) {
		const file = square.codePointAt(0) - 'a'.codePointAt(0);
		const rank = Number.parseInt(square[1], 10);

		if (this._orientation === 'white') {
			return { col: file, row: 8 - rank };
		}
		return { col: 7 - file, row: rank - 1 };
	}

	#disablePieceAnimOnce() {
		if (!this._ui?.boardEl) return;
		const boardEl = this._ui.boardEl;
		boardEl.classList.add('cbw-no-anim');
		requestAnimationFrame(() => {
			boardEl.classList.remove('cbw-no-anim');
		});
	}

	#syncPieces({ animateMove } = {}) {
		if (!this._piecesLayer || !this._game) return;

		if (!animateMove) this.#disablePieceAnimOnce();

		// reuse DOM element from from->to so CSS transition actually animates
		if (animateMove && this._lastMove?.from && this._lastMove?.to) {
			const { from, to } = this._lastMove;

			const captured = this._pieceElsBySquare.get(to);
			if (captured) {
				captured.remove();
				this._pieceElsBySquare.delete(to);
			}

			const movingEl = this._pieceElsBySquare.get(from);
			if (movingEl) {
				this._pieceElsBySquare.delete(from);
				this._pieceElsBySquare.set(to, movingEl);
				movingEl.dataset.square = to;
			}
		}

		const neededSquares = new Set();

		for (const sq of this.#allSquares()) {
			const piece = this._game.get(sq);
			if (!piece) continue;

			neededSquares.add(sq);

			let el = this._pieceElsBySquare.get(sq);
			const src = this.#getPieceImageSrc(piece);

			if (!el) {
				if (src) {
					const img = document.createElement('img');
					img.className = 'cbw-piece';
					img.src = src;
					img.alt = `${piece.color}${piece.type}`;
					img.draggable = false;
					img.style.pointerEvents = 'none';
					img.dataset.square = sq;
					el = img;
				} else {
					const span = document.createElement('span');
					span.className = 'cbw-piece cbw-piece-fallback';
					span.textContent = PIECES_FALLBACK[piece.color]?.[piece.type] ?? '';
					span.style.pointerEvents = 'none';
					span.dataset.square = sq;
					el = span;
				}

				this._piecesLayer.appendChild(el);
				this._pieceElsBySquare.set(sq, el);
			} else {
				if (el.tagName === 'IMG') {
					if (src && el.src !== src) el.src = src;
				} else {
					const txt = PIECES_FALLBACK[piece.color]?.[piece.type] ?? '';
					if (el.textContent !== txt) el.textContent = txt;
				}
			}

			const { col, row } = this.#squareToGridXY(sq);
			el.style.left = `${col * 12.5}%`;
			el.style.top = `${row * 12.5}%`;
		}

		for (const [sq, el] of this._pieceElsBySquare.entries()) {
			if (neededSquares.has(sq)) continue;
			el.remove();
			this._pieceElsBySquare.delete(sq);
		}
	}

	#renderSquares() {
		if (!this._squaresLayer || !this._game) return;

		const layer = this._squaresLayer;
		layer.innerHTML = '';

		const squares = this.#orderedSquares();
		for (const sq of squares) {
			const cell = document.createElement('div');
			cell.className = `cbw-square ${this.#isLightSquare(sq) ? 'cbw-light' : 'cbw-dark'}`;
			cell.dataset.square = sq;

			if (this._selectedFrom === sq) cell.classList.add('cbw-selected');
			if (this._legalTargets.has(sq)) cell.classList.add('cbw-legal');
			if (this._lastMove && (this._lastMove.from === sq || this._lastMove.to === sq)) cell.classList.add('cbw-last');

			cell.addEventListener('click', () => this.#onSquareClick(sq));
			layer.appendChild(cell);
		}
	}

	#renderBoard(animateMove = false) {
		if (!this._ui?.boardEl || !this._game) return;

		this.#ensureBoardLayers();
		this.#renderSquares();
		this.#syncPieces({ animateMove });
	}

	#onSquareClick(square) {
		// ✅ don’t allow clicks while animating external PGN
		if (this._isAnimating) return;

		const piece = this._game.get(square);
		const turn = this._game.turn();

		if (!this._selectedFrom) {
			if (piece && piece.color === turn) {
				this._selectedFrom = square;
				this.#computeLegals(square);
				this.#renderBoard(false);
			}
			return;
		}

		if (this._selectedFrom === square) {
			this.#clearSelection();
			this.#renderBoard(false);
			return;
		}

		const from = this._selectedFrom;
		const to = square;

		if (piece && piece.color === turn) {
			this._selectedFrom = square;
			this.#computeLegals(square);
			this.#renderBoard(false);
			return;
		}

		const move = this._game.move({ from, to, promotion: 'q' });
		if (!move) {
			this.#computeLegals(from);
			this.#renderBoard(false);
			return;
		}

		this._lastMove = { from: move.from, to: move.to };
		this.#clearSelection();

		// animate user move
		this.#renderBoard(true);

		this.#renderStatus();
		this.#commitBoardToStore();
	}

	#computeLegals(fromSquare) {
		this._legalTargets.clear();
		try {
			const moves = this._game.moves({ square: fromSquare, verbose: true }) || [];
			for (const m of moves) this._legalTargets.add(m.to);
		} catch {}
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
		} catch {}

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
