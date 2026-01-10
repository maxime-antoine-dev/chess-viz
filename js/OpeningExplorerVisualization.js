import { Visualization } from "./Visualization.js";
import { openingExplorerState } from "./OpeningExplorerState.js";
import { ChessboardWidget } from "./Chessboard.js";
import { OPENING_FIRST_MOVES } from "./openings.js";

class OpeningExplorerVisualization extends Visualization {

    constructor(data, container) {
        super(data, container, { top: 0, right: 0, bottom: 0, left: 0 });
        this._boardWidget = null;
        this._lastOpeningApplied = null;
        this._lastColorApplied = null;
        this._unsub = null;
        this.initialized = false;
        this._sun_vis = null;
    }

    async init() {
        if (!this.initialized) {
            this.loadData();
            this.measure();
            this.setupSVG();
            await this.initBoardWidget();
            this.initialized = true;
        }
        return this;
    }

    render(time_control, elo, color, opening) {
        // 1. Mise à jour des filtres locaux
        this.filters.time_control = time_control;
        this.filters.elo = elo;
        this.filters.color = Number.parseInt(color);
        this.filters.opening = opening;

        this.init().then(async () => {
            // 2. Gestion de l'orientation du plateau
            if (this._lastColorApplied !== color) {
                this._lastColorApplied = color;
                const ori = String(color) === "2" ? "black" : "white";
                this._boardWidget.setOrientation(ori);
            }

            // 3. Gestion de l'ouverture (PGN)
            if (this._lastOpeningApplied !== opening) {
                this._lastOpeningApplied = opening;
                let pgn = "";
                if (opening && opening !== "All") {
                    pgn = OPENING_FIRST_MOVES?.[opening] ?? "";
                }
                openingExplorerState.setPGN(pgn);
            }

            // 4. MISE À JOUR DU GRAPHIQUE 
            await this.initSunburst();

        }).catch((err) => console.error("Render error:", err));
    }

    // === Logique Sunburst ===

    async initSunburst() {
        const chartEl = this.container.querySelector("#oe-sunburst");
        if (!chartEl) return;

        //  rafraîchissement des données
        d3.select(chartEl).selectAll("*").remove();

        const width = 500;
        const height = 500;
        const radius = Math.min(width, height) / 2;

        this._sun_vis = d3.select(chartEl)
            .append("svg")
            .attr("viewBox", `0 0 ${width} ${height}`)
            .style("width", "100%")
            .style("height", "auto")
            .append("g")
            .attr("transform", `translate(${width / 2},${height / 2})`);

        const tc = this.filters.time_control;
        const elo = this.filters.elo;
        const opening = this.filters.opening;

        // Accès aux données filtrées
        let rawData = this.data?.payload?.[tc]?.[elo];

        if (!rawData) {
            this._sun_vis.append("text").attr("text-anchor", "middle").text("No data");
            return;
        }

        let targetData;
        let rootName;

        if (opening && opening !== "All" && rawData[opening]) {
            targetData = rawData[opening];
            rootName = opening;
        } else {
            targetData = rawData;
            rootName = "All Openings";
        }

        // Transformation hiérarchique
        const hierarchyData = {
            name: rootName,
            children: (rootName === "All Openings") 
                ? Object.entries(targetData).map(([k, v]) => this._sun_recursiveTransform(k, v))
                : [this._sun_recursiveTransform(rootName, targetData)]
        };

        this._sun_createVisualization(hierarchyData, radius);
    }

    _sun_recursiveTransform(key, data) {
        const node = { name: data.name || key };
        if (data.next_moves && Object.keys(data.next_moves).length > 0) {
            node.children = Object.entries(data.next_moves).map(([ck, cv]) => this._sun_recursiveTransform(ck, cv));
        } else {
            node.size = data.count || 1;
        }
        if (data.count) node.value = data.count;
        return node;
    }

    _sun_createVisualization(json, radius) {
        const partition = d3.partition().size([2 * Math.PI, radius]);
        const root = d3.hierarchy(json)
            .sum(d => d.size || 0)
            .sort((a, b) => b.value - a.value);

        partition(root);

        const arc = d3.arc()
            .startAngle(d => d.x0)
            .endAngle(d => d.x1)
            .innerRadius(d => d.y0)
            .outerRadius(d => d.y1);

        const colorScale = d3.scaleOrdinal(d3.quantize(d3.interpolateRainbow, root.children?.length + 1 || 2));

        this._sun_vis.selectAll("path")
            .data(root.descendants().filter(d => d.depth && (d.x1 - d.x0 > 0.001)))
            .enter().append("path")
            .attr("d", arc)
            .style("fill", d => colorScale(d.ancestors().reverse()[1]?.data.name))
            .style("stroke", "#0b1220")
            .style("opacity", 0.8)
            .on("mouseover", (event, d) => {
                const tooltip = document.getElementById("tooltip");
                if (tooltip) {
                    tooltip.style.opacity = 1;
                    tooltip.innerHTML = `<strong>${d.data.name}</strong><br>Games: ${d.value}`;
                }
            })
            .on("mousemove", (event) => {
                const tooltip = document.getElementById("tooltip");
                if (tooltip) {
                    tooltip.style.left = (event.pageX + 10) + "px";
                    tooltip.style.top = (event.pageY - 10) + "px";
                }
            })
            .on("mouseleave", () => {
                const tooltip = document.getElementById("tooltip");
                if (tooltip) tooltip.style.opacity = 0;
            });
    }

    // === Chessboard===

    async initBoardWidget() {
        const boardEl = this.container.querySelector("#oe-board");
        const btnReset = this.container.querySelector("#oe-reset");
        const btnFlip = this.container.querySelector("#oe-flip");

        if (!boardEl) return;

        this._boardWidget = new ChessboardWidget({ store: openingExplorerState });
        await this._boardWidget.mount({ boardEl });

        if (btnReset) {
            btnReset.addEventListener("click", () => {
                document.getElementById("opening").value = "All";
                openingExplorerState.setPGN("", { source: "reset", force: true });
            });
        }
        if (btnFlip) btnFlip.addEventListener("click", () => this._boardWidget.flip());

        this._unsub = openingExplorerState.onPGNChange(({ pgn }) => {
            const detected = this.detectOpeningFromPgnPrefix(pgn || "");
            const opSel = document.getElementById("opening");
            if (detected && opSel) opSel.value = detected;
        });
    }

    detectOpeningFromPgnPrefix(pgnMovetext) {
        const entries = Object.entries(OPENING_FIRST_MOVES || {})
            .filter(([k, v]) => k !== "All" && v)
            .sort((a, b) => b[1].length - a[1].length);

        for (const [name, prefix] of entries) {
            if (pgnMovetext.startsWith(prefix)) return name;
        }
        return null;
    }
}

export { OpeningExplorerVisualization };