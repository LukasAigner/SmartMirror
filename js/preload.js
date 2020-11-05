const fs = require("fs");
const path = require("path");
var data = fs.readFileSync(path.resolve(__dirname + "/../modules/MMM-Remote-Control/window.json"));
data = JSON.parse(data.toString());

process.once("loaded", () => {
	try {
		require("electron").webFrame.setZoomFactor(data.zoom);
	} catch (err) {
		console.log("Zoom applied");
	}
});
