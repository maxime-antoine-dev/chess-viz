import { Visualization } from "./Visualization.js";
import { openingExplorerState } from "./OpeningExplorerState.js";
import { ChessboardWidget } from "./Chessboard.js";

class OpeningExplorerVisualization extends Visualization {
  constructor(data, container) {
    super(data, container, { top: 0, right: 0, bottom: 0, left: 0 });

    this._initialized = false;
    this._boardWidget = null;
  }

  render(time_control, elo, color, opening) {
    this.#initOnce()
      .then(() => {
        this.filters.time_control = time_control;
        this.filters.elo = elo;
        this.filters.color = Number.parseInt(color);
        this.filters.opening = opening;
      })
      .catch((err) => console.error(err));
  }

  async #initOnce() {
    if (this._initialized) return;

    const containerEl =
      typeof this.container === "string"
        ? document.querySelector(this.container)
        : this.container;
    if (!containerEl) throw new Error("OpeningExplorer container not found");
    this.container = containerEl;

    // Grab HTML elements
    const boardEl = this.container.querySelector("#oe-board");

    const btnReset = this.container.querySelector("#oe-reset");
    const btnFlip = this.container.querySelector("#oe-flip");

    if (!boardEl || !btnReset || !btnFlip) {
      throw new Error(
        "OpeningExplorer HTML elements missing in #opening_explorer"
      );
    }

    // Board widget
    this._boardWidget = new ChessboardWidget({ store: openingExplorerState });
    await this._boardWidget.mount({ boardEl });

    // Buttons
    btnReset.addEventListener("click", () => {
      openingExplorerState.setPGN("", { source: "reset" });
    });

    btnFlip.addEventListener("click", () => {
      this._boardWidget.flip();
    });

    this._initialized = true;
  }
}

export { OpeningExplorerVisualization };
