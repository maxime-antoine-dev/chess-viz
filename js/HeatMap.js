var margin = { top: 20, right: 30, bottom: 60, left: 60 },
  width = 450 - margin.left - margin.right,
  height = 450 - margin.top - margin.bottom;
var globalData, svg, xScale, yScale, color;

function update() {
  if (!globalData) return;
  const selectedElo = d3.select("#elo").property("value");
  const selectedCadence = d3.select("#time_control").property("value");

  const matrice = globalData.payload[selectedCadence][selectedElo].All.heatmap;

  console.log(matrice);

  if (!matrice || matrice.length === 0) {
    console.warn("Pas de données pour cette sélection");
    svg.selectAll("rect").remove();
    return;
  }

  const dataset = [];
  matrice.forEach((row, yIndex) => {
    row.forEach((winRate, xIndex) => {
      dataset.push({ x: xIndex * 10, y: yIndex * 10, value: winRate });
    });
  });

  const rects = svg.selectAll("rect").data(dataset);

  rects
    .enter()
    .append("rect")
    .merge(rects)
    .transition()
    .duration(500)
    .attr("x", (d) => xScale(d.x))
    .attr("y", (d) => yScale(d.y))
    .attr("width", xScale.bandwidth())
    .attr("height", yScale.bandwidth())
    .style("fill", (d) => color(d.value))
    .style("stroke", "white");

  svg
    .selectAll("rect")
    .on("mouseover", function (event, d) {
      const tooltip = d3.select("#tooltip");
      tooltip.transition().duration(200).style("opacity", 0.9);
      tooltip
        .html(`Taux de victoire : ${(d.value * 100).toFixed(1)}%`)
        .style("left", event.pageX + 10 + "px")
        .style("top", event.pageY - 20 + "px");
    })
    .on("mouseout", function () {
      d3.select("#tooltip").transition().duration(500).style("opacity", 0);
    });

  rects.exit().remove();
}

d3.json("./data_processing/json/opening_accuracy_heatmap/acc_heatmap.json")
  .then(function (json) {
    globalData = json;
    // console.log(globalData);
    console.log("JSON chargé avec succès");

    xScale = d3
      .scaleBand()
      .range([0, width])
      .domain(d3.range(0, 110, 10))
      .padding(0.01);

    yScale = d3
      .scaleBand()
      .range([height, 0])
      .domain(d3.range(0, 110, 10))
      .padding(0.01);

    color = d3
      .scaleSequential()
      .interpolator(d3.interpolateRdYlGn)
      .domain([0, 1]);

    svg = d3
      .select("#HeatMap")
      .append("svg")
      .attr("width", width + margin.left + margin.right)
      .attr("height", height + margin.top + margin.bottom + 20)
      .append("g")
      .attr("transform", "translate(" + margin.left + "," + margin.top + ")");

    const xAxis = d3.axisBottom(xScale);
    const yAxis = d3.axisLeft(yScale);
    svg
      .append("g")
      .attr("id", "x-axis")
      .attr("transform", "translate(-18," + height + ")")
      .call(xAxis);

    svg
      .append("g")
      .attr("id", "y-axis")
      .attr("transform", "translate(0," + margin.top + ")")
      .call(yAxis);

    svg
      .append("text")
      .attr("x", width / 2)
      .attr("y", height + margin.top + 15)
      .attr("text-anchor", "middle")
      .style("font-size", "14px")
      .text("Précision moyenne lors de l'ouverture");

    svg
      .append("text")
      .attr("transform", "rotate(-90)")
      .attr("x", -height / 2)
      .attr("y", -margin.right)
      .attr("text-anchor", "middle")
      .style("font-size", "14px")
      .text("Précision moyenne après l'ouverture");


    d3.selectAll("#elo, #time_control").on("change", update);

    update();
  })
  .catch(function (error) {
    console.error("Erreur de chargement :", error);
  });
