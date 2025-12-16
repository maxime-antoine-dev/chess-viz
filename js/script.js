let time_control = "rapid";
let elo = "0_500";

update(time_control, elo);

document.getElementById("time_control").addEventListener("change", function() {
	time_control = this.value;
	update(time_control, elo);
});

document.getElementById("elo").addEventListener("change", function() {
	elo = this.value;
	update(time_control, elo);
});

function update(time_control, elo) {
	console.log("Updating with time control: " + time_control + " and elo: " + elo);
	// TODO: Update the 3 charts
}