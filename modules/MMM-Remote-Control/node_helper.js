/* Magic Mirror
 * Module: Remote Control
 *
 * By Joseph Bethge
 * MIT Licensed.
 */
/* jshint node: true, esversion: 6 */

const NodeHelper = require("node_helper");
const path = require("path");
const url = require("url");
const fs = require("fs");
const util = require("util");
const exec = require("child_process").exec;
const os = require("os");
const simpleGitpromise = require("simple-git/promise");
const simpleGit = require("simple-git");
const bodyParser = require("body-parser");
const express = require("express");

var defaultModules = require(path.resolve(__dirname + "/../default/defaultmodules.js"));

Module = {
	configDefaults: {},
	register: function (name, moduleDefinition) {
		// console.log("Module config loaded: " + name);
		Module.configDefaults[name] = moduleDefinition.defaults;
	}
};

module.exports = NodeHelper.create(
	Object.assign(
		{
			// Subclass start method.
			start: function () {
				var self = this;

				this.initialized = false;
				console.log("Starting node helper for: " + self.name);

				// load fall back translation
				self.loadTranslation("en");

				this.configOnHd = {};
				this.configData = {};

				this.waiting = [];

				this.template = "";
				this.modulesAvailable = [];
				this.modulesInstalled = [];

				fs.readFile(path.resolve(__dirname + "/remote.html"), function (err, data) {
					self.template = data.toString();
				});

				this.combineConfig();
				this.updateModuleList();
				this.createRoutes();

				/* API EXTENSION - Added v1.1.0 */
				this.externalApiRoutes = {};
				this.createApiRoutes();
			},

			combineConfig: function () {
				// function copied from MichMich (MIT)
				var defaults = require(__dirname + "/../../js/defaults.js");
				var configFilename = path.resolve(__dirname + "/../../config/config.js");
				if (typeof global.configuration_file !== "undefined") {
					configFilename = global.configuration_file;
				}

				try {
					fs.accessSync(configFilename, fs.F_OK);
					var c = require(configFilename);
					var config = Object.assign({}, defaults, c);
					this.configOnHd = config;
				} catch (e) {
					if (e.code == "ENOENT") {
						console.error("MMM-Remote-Control WARNING! Could not find config file. Please create one. Starting with default configuration.");
						this.configOnHd = defaults;
					} else if (e instanceof ReferenceError || e instanceof SyntaxError) {
						console.error("MMM-Remote-Control WARNING! Could not validate config file. Please correct syntax errors. Starting with default configuration.");
						this.configOnHd = defaults;
					} else {
						console.error("MMM-Remote-Control WARNING! Could not load config file. Starting with default configuration. Error found: " + e);
						this.configOnHd = defaults;
					}
				}

				this.loadTranslation(this.configOnHd.language);
			},

			createRoutes: function () {
				var self = this;

				/*this.expressApp.get("/remote.html", function(req, res) {
                if (self.template === "") {
                    res.send(503);
                } else {
                    res.contentType("text/html");
                    var transformedData = self.fillTemplates(self.template);
                    res.send(transformedData);
                }
            });*/

				this.expressApp.get("/get", function (req, res) {
					var query = url.parse(req.url, true).query;

					self.answerGet(query, res);
				});
				this.expressApp.post("/post", function (req, res) {
					var query = url.parse(req.url, true).query;

					self.answerPost(query, req, res);
				});

				this.expressApp.get("/config-help.html", function (req, res) {
					var query = url.parse(req.url, true).query;

					self.answerConfigHelp(query, res);
				});

				this.expressApp.get("/remote", function (req, res) {
					var query = url.parse(req.url, true).query;

					if (query.action) {
						var result = self.executeQuery(query, res);
						if (result === true) {
							return;
						}
					}
					res.send({ status: "error", reason: "unknown_command", info: "original input: " + JSON.stringify(query) });
				});
			},

			capitalizeFirst: function (string) {
				return string.charAt(0).toUpperCase() + string.slice(1);
			},

			formatName: function (string) {
				string = string.replace(/MMM?-/gi, "").replace(/_/g, " ").replace(/-/g, " ");
				string = string.replace(/([a-z])([A-Z])/g, function (txt) {
					// insert space into camel case
					return txt.charAt(0) + " " + txt.charAt(1);
				});
				string = string.replace(/\w\S*/g, function (txt) {
					// make character after white space upper case
					return txt.charAt(0).toUpperCase() + txt.substr(1);
				});
				return string.charAt(0).toUpperCase() + string.slice(1);
			},

			updateModuleList: function (force) {
				var self = this;
				var downloadModules = require("./scripts/download_modules");
				downloadModules({
					force: force,
					callback: (result) => {
						if (result && result.startsWith("ERROR")) {
							console.error(result);
						}
						this.readModuleData();
					}
				});
			},

			readModuleData: function () {
				var self = this;

				fs.readFile(path.resolve(__dirname + "/modules.json"), (err, data) => {
					self.modulesAvailable = JSON.parse(data.toString());

					for (let i = 0; i < self.modulesAvailable.length; i++) {
						self.modulesAvailable[i].name = self.formatName(self.modulesAvailable[i].longname);
						self.modulesAvailable[i].isDefaultModule = false;
					}

					for (let i = 0; i < defaultModules.length; i++) {
						let url;
						let desc;
						if (defaultModules[i] === "alert") {
							desc = "This module displays notifications from other modules.";
							url = "https://docs.magicmirror.builders/modules/alert.html";
						}
						if (defaultModules[i] === "calendar") {
							desc = "This module displays events from a public .ical calendar. It can combine multiple calendars.";
							url = "https://docs.magicmirror.builders/modules/calendar.html";
						}
						if (defaultModules[i] === "clock") {
							desc = "This module displays the current date and time. The information will be updated realtime.";
							url = "https://docs.magicmirror.builders/modules/clock.html";
						}
						if (defaultModules[i] === "compliments") {
							desc = "This module displays a random compliment.";
							url = "https://docs.magicmirror.builders/modules/compliments.html";
						}
						if (defaultModules[i] === "currentweather") {
							desc = "This module displays the current weather, including the windspeed, the sunset or sunrise time, the temperature and an icon to display the current conditions.";
							url = "https://docs.magicmirror.builders/modules/currentweather.html";
						}
						if (defaultModules[i] === "helloworld") {
							desc = "It is a simple way to display a static text on the mirror.";
							url = "https://docs.magicmirror.builders/modules/helloworld.html";
						}
						if (defaultModules[i] === "newsfeed") {
							desc = "This module displays news headlines based on an RSS feed.";
							url = "https://docs.magicmirror.builders/modules/newsfeed.html";
						}
						if (defaultModules[i] === "updatenotification") {
							desc = "This will display a message whenever a new version of the MagicMirror application is available.";
							url = "https://docs.magicmirror.builders/modules/updatenotification.html#using-the-module";
						}
						if (defaultModules[i] === "weather") {
							desc = "The module will be configurable to be used as a current weather view, or to show the forecast.";
							url = "https://docs.magicmirror.builders/modules/weather.html#example";
						}
						if (defaultModules[i] === "weatherforecast") {
							desc = "This module displays the weather forecast for the coming week, including an an icon to display the current conditions, the minimum temperature and the maximum temperature.";
							url = "https://docs.magicmirror.builders/modules/weatherforecast.html";
						}
						self.modulesAvailable.push({
							longname: defaultModules[i],
							name: self.capitalizeFirst(defaultModules[i]),
							isDefaultModule: true,
							installed: true,
							author: "MichMich",
							desc: desc,
							id: "MichMich/MagicMirror",
							url: url,
							cat: "default"
						});
						var module = self.modulesAvailable[self.modulesAvailable.length - 1];
						var modulePath = self.configOnHd.paths.modules + "/default/" + defaultModules[i];
						self.loadModuleDefaultConfig(module, modulePath);
					}

					// now check for installed modules
					fs.readdir(path.resolve(__dirname + "/.."), function (err, files) {
						for (var i = 0; i < files.length; i++) {
							if (files[i] !== "node_modules" && files[i] !== "default") {
								self.addModule(files[i]);
							}
						}
					});
				});
			},

			addModule: function (folderName) {
				var self = this;

				var modulePath = this.configOnHd.paths.modules + "/" + folderName;
				fs.stat(modulePath, (err, stats) => {
					if (stats.isDirectory()) {
						var isInList = false;
						var currentModule;
						self.modulesInstalled.push(folderName);
						for (var i = 0; i < self.modulesAvailable.length; i++) {
							if (self.modulesAvailable[i].longname === folderName) {
								isInList = true;
								self.modulesAvailable[i].installed = true;
								currentModule = self.modulesAvailable[i];
							}
						}
						if (!isInList) {
							var newModule = {
								longname: folderName,
								name: self.formatName(folderName),
								isDefaultModule: false,
								installed: true,
								author: "unknown",
								desc: "",
								id: "local/" + folderName,
								url: "",
								cat: "local"
							};
							self.modulesAvailable.push(newModule);
							currentModule = newModule;
						}
						self.loadModuleDefaultConfig(currentModule, modulePath);

						// check for available updates
						var stat;
						try {
							stat = fs.statSync(path.join(modulePath, ".git"));
						} catch (err) {
							// Error when directory .git doesn't exist
							// This module is not managed with git, skip
							return;
						}

						var sg = simpleGit(modulePath);
						if (!isInList) {
							sg.getRemotes(true, function (error, result) {
								if (error) {
									console.log(error);
								}
								var baseUrl = result[0].refs.fetch;
								// replacements
								baseUrl = baseUrl.replace(".git", "").replace("github.com:", "github.com/");
								// if cloned with ssh
								currentModule.url = baseUrl.replace("git@", "https://");
							});
						}
					}
				});
			},

			checkForUpdate: function (installed) {
				return new Promise((resolve, reject) => {
					var fetchCalls = [];
					var statusCalls = [];
					var elementsToChange = [];
					installed.forEach((element) => {
						let update = false;
						let test;
						var modulePath = this.configOnHd.paths.modules + "/" + element.longname;
						var stat;
						try {
							element.updateAvailable = false;
							stat = fs.statSync(path.join(modulePath, ".git"));
						} catch (err) {
							// Error when directory .git doesn't exist
							// This module is not managed with git, skip
							//console.log("false no git " + element.name)
							element.updateAvailable = false;
							return;
						}

						try {
							var sg = simpleGitpromise(modulePath);
							fetchCalls.push(sg.fetch());
							statusCalls.push(sg.status());
							elementsToChange.push(element);
						} catch (err) {
							console.log(err);
							reject(err);
						}
					});
					Promise.all(fetchCalls).then(() => {
						Promise.all(statusCalls).then((result) => {
							for (let i = 0; i < result.length; i++) {
								if (result[i].behind > 0) {
									elementsToChange[i].updateAvailable = true;
									//console.log(elementsToChange[i].updateAvailable + elementsToChange[i].name);
								} else {
									//console.log("false no update " + elementsToChange[i].name);
								}
							}
							resolve();
						});
					});
				});
			},

			loadModuleDefaultConfig: function (module, modulePath) {
				// function copied from MichMich (MIT)
				var filename = path.resolve(modulePath + "/" + module.longname + ".js");
				try {
					fs.accessSync(filename, fs.F_OK);
					var jsfile = require(filename);
					// module.configDefault = Module.configDefaults[module.longname];
				} catch (e) {
					if (e.code == "ENOENT") {
						console.error("ERROR! Could not find main module js file for " + module.longname);
					} else if (e instanceof ReferenceError || e instanceof SyntaxError) {
						console.error("ERROR! Could not validate main module js file.");
						console.error(e);
					} else {
						console.error("ERROR! Could not load main module js file. Error found: " + e);
					}
				}
			},

			answerConfigHelp: function (query, res) {
				if (defaultModules.indexOf(query.module) !== -1) {
					// default module
					var dir = path.resolve(__dirname + "/..");
					let git = simpleGit(dir);
					git.revparse(["HEAD"], function (error, result) {
						if (error) {
							console.log(error);
						}
						res.writeHead(302, { Location: "https://github.com/MichMich/MagicMirror/tree/" + result.trim() + "/modules/default/" + query.module });
						res.end();
					});
					return;
				}
				var modulePath = this.configOnHd.paths.modules + "/" + query.module;
				let git = simpleGit(modulePath);
				git.getRemotes(true, function (error, result) {
					if (error) {
						console.log(error);
					}
					var baseUrl = result[0].refs.fetch;
					// replacements
					baseUrl = baseUrl.replace(".git", "").replace("github.com:", "github.com/");
					// if cloned with ssh
					baseUrl = baseUrl.replace("git@", "https://");
					git.revparse(["HEAD"], function (error, result) {
						if (error) {
							console.log(error);
						}
						res.writeHead(302, { Location: baseUrl + "/tree/" + result.trim() });
						res.end();
					});
				});
			},

			getConfig: function () {
				var config = this.configOnHd;
				for (let i = 0; i < config.modules.length; i++) {
					var current = config.modules[i];
					var def = Module.configDefaults[current.module];
					if (!("config" in current)) {
						current.config = {};
					}
					if (!def) {
						def = {};
					}
					for (var key in def) {
						if (!(key in current.config)) {
							current.config[key] = def[key];
						}
					}
				}
				return config;
			},

			removeDefaultValues: function (config) {
				// remove cached version
				delete require.cache[require.resolve(__dirname + "/../../js/defaults.js")];
				// then reload default config
				var defaultConfig = require(__dirname + "/../../js/defaults.js");

				for (let key in defaultConfig) {
					if (defaultConfig.hasOwnProperty(key) && config && config.hasOwnProperty(key) && defaultConfig[key] === config[key]) {
						delete config[key];
					}
				}

				for (let i = 0; i < config.modules.length; i++) {
					var current = config.modules[i];
					var def = Module.configDefaults[current.module];
					if (!def) {
						def = {};
					}
					for (let key in def) {
						if (def.hasOwnProperty(key) && current.config.hasOwnProperty(key) && def[key] === current.config[key]) {
							delete current.config[key];
						}
					}
					// console.log(current.config);
					if (current.config === {}) {
						delete current[config];
						continue;
					}
					// console.log(current);
				}

				return config;
			},

			answerPost: function (query, req, res) {
				var self = this;

				if (query.data === "config") {
					var backupHistorySize = 5;
					var configPath = path.resolve("config/config.js");

					var best = -1;
					var bestTime = null;
					for (var i = backupHistorySize - 1; i > 0; i--) {
						let backupPath = path.resolve("config/config.js.backup" + i);
						try {
							var stats = fs.statSync(backupPath);
							if (best === -1 || stats.mtime < bestTime) {
								best = i;
								bestTime = stats.mtime;
							}
						} catch (e) {
							if (e.code === "ENOENT") {
								// does not exist yet
								best = i;
								bestTime = "0000-00-00T00:00:00Z";
							}
						}
					}
					if (best === -1) {
						// can not backup, panic!
						console.error("MMM-Remote-Control Error! Backing up config failed, not saving!");
						self.sendResponse(res, new Error("Backing up config failed, not saving!"), { query: query });
						return;
					}
					let backupPath = path.resolve("config/config.js.backup" + best);

					var source = fs.createReadStream(configPath);
					var destination = fs.createWriteStream(backupPath);

					// back up last config
					source.pipe(destination, { end: false });
					source.on("end", () => {
						self.configOnHd = self.removeDefaultValues(req.body);

						var header = "/*************** AUTO GENERATED BY REMOTE CONTROL MODULE ***************/\n\nvar config = \n";
						var footer = "\n\n/*************** DO NOT EDIT THE LINE BELOW ***************/\nif (typeof module !== 'undefined') {module.exports = config;}\n";

						fs.writeFile(
							configPath,
							header +
								util.inspect(self.configOnHd, {
									showHidden: false,
									depth: null,
									maxArrayLength: null,
									compact: false
								}) +
								footer,
							(error) => {
								query.data = "config_update";
								if (error) {
									self.sendResponse(res, error, { query: query, backup: backupPath, config: self.configOnHd });
								}
								console.info("MMM-Remote-Control saved new config!");
								console.info("Used backup: " + backupPath);
								self.sendResponse(res, undefined, { query: query, backup: backupPath, config: self.configOnHd });
							}
						);
					});
				}
			},

			answerGet: function (query, req, res) {
				var self = this;

				if (query.data === "modulesAvailable") {
					self.updateModuleList();
					this.modulesAvailable.sort(function (a, b) {
						return a.name.localeCompare(b.name);
					});
					this.sendResponse(res, undefined, { query: query, data: this.modulesAvailable });
					return;
				}
				if (query.data === "modulesAvailablePOST") {
					self.updateModuleList();
					let modulesreturntemp = [];
					let modulesreturn = [];
					if (req.body.cat) {
						this.modulesAvailable.forEach((element) => {
							if (element.cat.toUpperCase() === req.body.cat.toUpperCase()) modulesreturntemp.push(element);
						});
					} else {
						modulesreturntemp = this.modulesAvailable;
					}
					if (req.body.search) {
						modulesreturntemp.forEach((element) => {
							if (element.name.toUpperCase().indexOf(req.body.search.toUpperCase()) !== -1 || element.desc.toUpperCase().indexOf(req.body.search.toUpperCase()) !== -1) {
								modulesreturn.push(element);
							}
						});
					} else {
						modulesreturn = modulesreturntemp;
					}
					if (req.body.sort.toUpperCase() === "A-Z") {
						modulesreturn.sort(function (a, b) {
							return a.name.localeCompare(b.name);
						});
					}
					if (req.body.sort.toUpperCase() === "Z-A") {
						modulesreturn.sort(function (a, b) {
							return b.name.localeCompare(a.name);
						});
					}

					var filterInstalled = function (value) {
						return value.installed;
					};
					var installed = self.modulesAvailable.filter(filterInstalled);

					modulesreturn = modulesreturn.filter((el) => !installed.includes(el));

					this.sendResponse(res, undefined, { query: query, data: modulesreturn });
					return;
				}
				if (query.data === "modulesInstalled") {
					self.updateModuleList();
					var filterInstalled = function (value) {
						return value.installed;
					};
					var installed = self.modulesAvailable.filter(filterInstalled);
					installed.sort(function (a, b) {
						return a.name.localeCompare(b.name);
					});
					this.sendResponse(res, undefined, { query: query, data: installed });
					return;
				}
				if (query.data === "modulesInstalledPOST") {
					self.updateModuleList();
					let modulesreturntemp = [];
					let modulesreturn = [];
					var filterInstalled = function (value) {
						return value.installed;
					};
					var installed = self.modulesAvailable.filter(filterInstalled);
					if (req.body.cat) {
						installed.forEach((element) => {
							if (element.cat.toUpperCase() === req.body.cat.toUpperCase()) modulesreturntemp.push(element);
						});
					} else {
						modulesreturntemp = installed;
					}
					if (req.body.search) {
						modulesreturntemp.forEach((element) => {
							if (element.name.toUpperCase().indexOf(req.body.search.toUpperCase()) !== -1 || element.desc.toUpperCase().indexOf(req.body.search.toUpperCase()) !== -1) modulesreturn.push(element);
						});
					} else {
						modulesreturn = modulesreturntemp;
					}
					if (req.body.sort.toUpperCase() === "A-Z") {
						modulesreturn.sort(function (a, b) {
							return a.name.localeCompare(b.name);
						});
					}
					if (req.body.sort.toUpperCase() === "Z-A") {
						modulesreturn.sort(function (a, b) {
							return b.name.localeCompare(a.name);
						});
					}

					let config = this.getConfig();

					for (let index = 0; index < modulesreturn.length; index++) {
						const pos = config.modules.findIndex((i) => i.module === modulesreturn[index].longname);
						if (pos !== -1) {
							modulesreturn[index].isActiv = true;
							if (this.hasProperty(config.modules[pos], "position")) {
								modulesreturn[index].displayed = true;
							} else {
								modulesreturn[index].displayed = false;
							}
						} else {
							modulesreturn[index].isActiv = false;
							modulesreturn[index].displayed = false;
						}
					}

					this.checkForUpdate(modulesreturn).then(() => {
						this.sendResponse(res, undefined, { query: query, data: modulesreturn });
					});
					return;
				}
				if (query.data === "translations") {
					this.sendResponse(res, undefined, { query: query, data: this.translation });
					return;
				}
				if (query.data === "categories") {
					self.updateModuleList();
					fs.readFile(path.resolve(__dirname + "/categories.json"), (err, data) => {
						let categories = JSON.parse(data.toString());
						this.sendResponse(res, undefined, { query: query, data: categories });
					});
					return;
				}
				if (query.data === "mmUpdateAvailable") {
					var sg = simpleGit(__dirname + "/..");
					sg.fetch().status((err, data) => {
						if (!err) {
							if (data.behind > 0) {
								this.sendResponse(res, undefined, { query: query, result: true });
								return;
							}
						}
						this.sendResponse(res, undefined, { query: query, result: false });
					});
					return;
				}
				if (query.data === "config") {
					this.sendResponse(res, undefined, { query: query, data: this.getConfig() });
					return;
				}
				if (query.data === "defaultConfig") {
					if (!(query.module in Module.configDefaults)) {
						this.sendResponse(res, undefined, { query: query, data: {} });
					} else {
						this.sendResponse(res, undefined, { query: query, data: Module.configDefaults[query.module] });
					}
					return;
				}
				if (query.data === "modules") {
					if (!this.checkInititialized(res)) {
						return;
					}
					this.callAfterUpdate(() => {
						this.sendResponse(res, undefined, { query: query, data: self.configData.moduleData });
					});
					return;
				}
				if (query.data === "brightness") {
					if (!this.checkInititialized(res)) {
						return;
					}
					this.callAfterUpdate(() => {
						this.sendResponse(res, undefined, { query: query, result: self.configData.brightness });
					});
					return;
				}
				if (query.data === "userPresence") {
					this.sendResponse(res, undefined, { query: query, result: this.userPresence });
					return;
				}
				// Unknown Command, Return Error
				this.sendResponse(res, "Unknown or Bad Command.", query);
			},

			callAfterUpdate: function (callback, timeout) {
				if (timeout === undefined) {
					timeout = 3000;
				}

				var waitObject = {
					finished: false,
					run: function () {
						if (this.finished) {
							return;
						}
						this.finished = true;
						this.callback();
					},
					callback: callback
				};

				this.waiting.push(waitObject);
				this.sendSocketNotification("UPDATE");
				setTimeout(function () {
					waitObject.run();
				}, timeout);
			},

			sendResponse: function (res, error, data) {
				let response = { success: true };
				let status = 200;
				let result = true;
				if (error) {
					console.log(error);
					response = { success: false, status: "error", reason: "unknown", info: error };
					status = 400;
					result = false;
				}
				if (data) {
					response = Object.assign({}, response, data);
				}
				if (res) {
					if ("isSocket" in res && res.isSocket) {
						this.sendSocketNotification("REMOTE_ACTION_RESULT", response);
					} else {
						res.status(status).json(response);
					}
				}
				return result;
			},

			hasProperty: function (object, key) {
				return object ? hasOwnProperty.call(object, key) : false;
			},

			monitorControl: function (action, opts, res) {
				let status = "unknown";
				let monitorOnCommand = this.initialized && "monitorOnCommand" in this.configData.remoteConfig.customCommand ? this.configData.remoteConfig.customCommand.monitorOnCommand : "tvservice --preferred && sudo chvt 6 && sudo chvt 7";
				let monitorOffCommand = this.initialized && "monitorOffCommand" in this.configData.remoteConfig.customCommand ? this.configData.remoteConfig.customCommand.monitorOffCommand : "tvservice -o";
				let monitorStatusCommand = this.initialized && "monitorStatusCommand" in this.configData.remoteConfig.customCommand ? this.configData.remoteConfig.customCommand.monitorStatusCommand : "tvservice --status";
				if (["MONITORTOGGLE", "MONITORSTATUS"].indexOf(action) !== -1) {
					screenStatus = exec(monitorStatusCommand, opts, (error, stdout, stderr) => {
						if (stdout.indexOf("TV is off") !== -1 || stdout.indexOf("false")) {
							// Screen is OFF, turn it ON
							status = "off";
							if (action === "MONITORTOGGLE") {
								this.monitorControl("MONITORON", opts, res);
								return;
							}
						} else if (stdout.indexOf("HDMI") !== -1 || stdout.indexOf("true")) {
							// Screen is ON, turn it OFF
							status = "on";
							if (action === "MONITORTOGGLE") {
								this.monitorControl("MONITOROFF", opts, res);
								return;
							}
						}
						this.checkForExecError(error, stdout, stderr, res, { monitor: status });
						return;
					});
				}
				if (action === "MONITORON") {
					exec(monitorOnCommand, opts, (error, stdout, stderr) => {
						this.checkForExecError(error, stdout, stderr, res, { monitor: "on" });
					});
					this.sendSocketNotification("USER_PRESENCE", true);
					return;
				} else if (action === "MONITOROFF") {
					exec(monitorOffCommand, (error, stdout, stderr) => {
						this.checkForExecError(error, stdout, stderr, res, { monitor: "off" });
					});
					this.sendSocketNotification("USER_PRESENCE", false);
					return;
				}
			},

			executeQuery: function (query, res) {
				var self = this;
				var opts = { timeout: 15000 };

				// If the query came from a socket notification, send result on same
				if ("isSocket" in query && query.isSocket && typeof res === "undefined") {
					res = { isSocket: true };
				}

				if (query.action === "SHUTDOWN") {
					exec("sudo shutdown -h now", opts, (error, stdout, stderr) => {
						self.checkForExecError(error, stdout, stderr, res);
					});
					self.sendResponse(res);
					return true;
				}
				if (query.action === "REBOOT") {
					exec("sudo shutdown -r now", opts, (error, stdout, stderr) => {
						self.checkForExecError(error, stdout, stderr, res);
					});
					self.sendResponse(res);
					return true;
				}
				if (query.action === "RESTART") {
					exec("pm2 ls", opts, (error, stdout, stderr) => {
						if (stdout.indexOf(" MagicMirror ") > -1) {
							exec("pm2 restart MagicMirror", opts, (error, stdout, stderr) => {
								self.sendSocketNotification("RESTART");
								self.checkForExecError(error, stdout, stderr, res);
							});
							self.sendResponse(res);
							return;
						}
						if (stdout.indexOf(" mm ") > -1) {
							exec("pm2 restart mm", opts, (error, stdout, stderr) => {
								self.sendSocketNotification("RESTART");
								self.checkForExecError(error, stdout, stderr, res);
							});
							self.sendResponse(res);
							return;
						}
						self.sendResponse(res, error);
					});
					return true;
				}
				if (query.action === "USER_PRESENCE") {
					this.sendSocketNotification("USER_PRESENCE", query.value);
					this.userPresence = query.value;
					this.sendResponse(res, undefined, query);
					return true;
				}
				if (["MONITORON", "MONITOROFF", "MONITORTOGGLE", "MONITORSTATUS"].indexOf(query.action) !== -1) {
					this.monitorControl(query.action, opts, res);
					return true;
				}
				if (query.action === "HIDE" || query.action === "SHOW" || query.action === "TOGGLE") {
					self.sendSocketNotification(query.action, query);
					self.sendResponse(res);
					return true;
				}
				if (query.action === "BRIGHTNESS") {
					self.sendResponse(res);
					self.sendSocketNotification(query.action, query.value);
					return true;
				}
				if (query.action === "SAVE") {
					self.sendResponse(res);
					self.callAfterUpdate(function () {
						self.saveDefaultSettings();
					});
					return true;
				}
				if (query.action === "MODULE_DATA") {
					self.callAfterUpdate(function () {
						self.sendResponse(res, undefined, self.configData);
					});
					return true;
				}
				if (query.action === "INSTALL") {
					self.installModule(query.url, res, query);
					return true;
				}
				if (query.action === "REFRESH") {
					self.sendResponse(res);
					self.sendSocketNotification(query.action);
					return true;
				}
				if (query.action === "HIDE_ALERT") {
					self.sendResponse(res);
					self.sendSocketNotification(query.action);
					return true;
				}
				if (query.action === "SHOW_ALERT") {
					self.sendResponse(res);

					var type = query.type ? query.type : "alert";
					var title = query.title ? query.title : "Note";
					var message = query.message ? query.message : "Attention!";
					var timer = query.timer ? query.timer : 4;

					self.sendSocketNotification(query.action, {
						type: type,
						title: title,
						message: message,
						timer: timer * 1000
					});
					return true;
				}
				if (query.action === "UPDATE") {
					self.updateModule(decodeURI(query.module), res);
					return true;
				}
				if (query.action === "NOTIFICATION") {
					try {
						var payload = {}; // Assume empty JSON-object if no payload is provided
						if (typeof query.payload === "undefined") {
							payload = query.payload;
						} else {
							payload = JSON.parse(query.payload);
						}

						this.sendSocketNotification(query.action, { notification: query.notification, payload: payload });
						this.sendResponse(res);
						return true;
					} catch (err) {
						console.log("ERROR: ", err);
						this.sendResponse(res, err, { reason: err.message });
						return true;
					}
				}
				if (["MINIMIZE", "TOGGLEFULLSCREEN", "DEVTOOLS"].indexOf(query.action) !== -1) {
					try {
						win = require("electron").BrowserWindow.getFocusedWindow();
						if (!win) {
							throw new Error("Could not get Electron window instance.");
						}
						switch (query.action) {
							case "MINIMIZE":
								win.minimize();
								break;
							case "TOGGLEFULLSCREEN":
								win.setFullScreen(!win.isFullScreen());
								break;
							case "DEVTOOLS":
								win.webContents.openDevTools();
								break;
							default:
						}
						this.sendResponse(res);
					} catch (err) {
						this.sendResponse(res, err);
					}
				}
				self.sendResponse(res, new Error(`Invalid Option: ${query.action}`));
				return false;
			},

			installModule: function (url, res, data) {
				var self = this;

				simpleGit(path.resolve(__dirname + "/..")).clone(url, path.basename(url), function (error, result) {
					if (error) {
						console.log(error);
						self.sendResponse(res, error);
					} else {
						var workDir = path.resolve(__dirname + "/../" + path.basename(url));
						exec("npm install", { cwd: workDir, timeout: 120000 }, (error, stdout, stderr) => {
							if (error) {
								console.log(error);
								self.sendResponse(res, error, Object.assign({ stdout: stdout, stderr: stderr }, data));
							} else {
								// success part
								self.readModuleData();
								self.sendResponse(res, undefined, Object.assign({ stdout: stdout }, data));
							}
						});
					}
				});
			},

			updateModule: function (module, res) {
				console.log("UPDATE " + (module || "MagicMirror"));

				var self = this;

				let localpath = __dirname + "/../../";
				var name = "MM";

				if (typeof module !== "undefined" && module !== "undefined") {
					if (self.modulesAvailable) {
						var modData = self.modulesAvailable.find((m) => m.longname === module);
						if (modData === undefined) {
							this.sendResponse(res, new Error("Unknown Module"), { info: modules });
							return;
						}

						localpath = __dirname + "/../" + modData.longname;
						name = modData.name;
					}
				}

				console.log(localpath);

				var git = simpleGit(localpath);
				git.pull((error, result) => {
					//console.log(result);
					if (error) {
						console.log(error);
						self.sendResponse(res, error);
						return;
					}
					if (result.summary.changes) {
						exec("npm install", { cwd: localpath, timeout: 120000 }, (error, stdout, stderr) => {
							if (error) {
								console.log(error);
								self.sendResponse(res, error, { stdout: stdout, stderr: stderr });
							} else {
								// success part
								self.readModuleData();
								self.sendResponse(res, undefined, { code: "restart", info: name + " updated." });
							}
						});
					} else {
						self.sendResponse(res, undefined, { code: "up-to-date", info: name + " already up to date." });
					}
				});
			},

			deleteModule: function (module, res) {
				var self = this;
				self.updateModuleList();
				var filterInstalled = function (value) {
					return value.installed;
				};
				var installed = self.modulesAvailable.filter(filterInstalled);

				if (module) {
					var modData = installed.find((m) => m.longname === module && m.isDefaultModule === false && m.longname !== "MMM-Remote-Control");
					if (modData === undefined) {
						this.sendResponse(res, new Error("Unknown Module"), { info: module });
						return;
					}
				}

				let localpath = __dirname + "/../" + modData.longname;

				this.deleteFolderRecursive(localpath);

				self.sendResponse(res, undefined, { info: "Module deleted" });
			},

			deleteFolderRecursive: function (localpath) {
				if (fs.existsSync(localpath)) {
					fs.readdirSync(localpath).forEach((file, index) => {
						const curPath = path.join(localpath, file);
						if (fs.lstatSync(curPath).isDirectory()) {
							// recurse
							this.deleteFolderRecursive(curPath);
						} else {
							// delete file
							fs.unlinkSync(curPath);
						}
					});
					fs.rmdirSync(localpath);
				}
			},

			checkForExecError: function (error, stdout, stderr, res, data) {
				console.log(stdout);
				console.log(stderr);
				this.sendResponse(res, error, data);
			},

			translate: function (data) {
				for (var key in this.translation) {
					var pattern = "%%TRANSLATE:" + key + "%%";
					while (data.indexOf(pattern) > -1) {
						data = data.replace(pattern, this.translation[key]);
					}
				}
				return data;
			},

			saveDefaultSettings: function () {
				var moduleData = this.configData.moduleData;
				var simpleModuleData = [];
				for (var k = 0; k < moduleData.length; k++) {
					simpleModuleData.push({});
					simpleModuleData[k].identifier = moduleData[k].identifier;
					simpleModuleData[k].hidden = moduleData[k].hidden;
					simpleModuleData[k].lockStrings = moduleData[k].lockStrings;
				}

				var text = JSON.stringify({
					moduleData: simpleModuleData,
					brightness: this.configData.brightness,
					settingsVersion: this.configData.settingsVersion
				});

				fs.writeFile(path.resolve(__dirname + "/settings.json"), text, function (err) {
					if (err) {
						throw err;
					}
				});
			},

			in: function (pattern, string) {
				return string.indexOf(pattern) !== -1;
			},

			loadDefaultSettings: function () {
				var self = this;

				fs.readFile(path.resolve(__dirname + "/settings.json"), function (err, data) {
					if (err) {
						if (self.in("no such file or directory", err.message)) {
							return;
						}
						console.log(err);
					} else {
						data = JSON.parse(data.toString());
						self.sendSocketNotification("DEFAULT_SETTINGS", data);
					}
				});
			},

			fillTemplates: function (data) {
				return this.translate(data);
			},

			loadTranslation: function (language) {
				var self = this;

				fs.readFile(path.resolve(__dirname + "/translations/" + language + ".json"), function (err, data) {
					if (err) {
						return;
					} else {
						self.translation = Object.assign({}, self.translation, JSON.parse(data.toString()));
					}
				});
			},

			getIpAddresses: function () {
				// module started, answer with current IP address
				var interfaces = os.networkInterfaces();
				var addresses = [];
				for (var k in interfaces) {
					for (var k2 in interfaces[k]) {
						var address = interfaces[k][k2];
						if (address.family === "IPv4" && !address.internal) {
							addresses.push(address.address);
						}
					}
				}
				return addresses;
			},

			socketNotificationReceived: function (notification, payload) {
				var self = this;

				if (notification === "CURRENT_STATUS") {
					this.configData = payload;
					if (!this.initialized) {
						this.getExternalApiByGuessing();
						// Do anything else required to initialize
						this.initialized = true;
					} else {
						this.waiting.forEach((o) => {
							o.run();
						});
						this.waiting = [];
					}
				}
				if (notification === "REQUEST_DEFAULT_SETTINGS") {
					// module started, answer with current ip addresses
					self.sendSocketNotification("IP_ADDRESSES", self.getIpAddresses());

					// check if we have got saved default settings
					self.loadDefaultSettings();
				}
				if (notification === "REMOTE_ACTION") {
					if ("action" in payload) {
						this.executeQuery(payload, { isSocket: true });
					} else if ("data" in payload) {
						this.answerGet(payload, { isSocket: true });
					}
				}
				if (notification === "NEW_CONFIG") {
					this.answerPost({ data: "config" }, { body: payload }, { isSocket: true });
				}
				if (notification === "REMOTE_CLIENT_CONNECTED") {
					this.sendSocketNotification("REMOTE_CLIENT_CONNECTED");
				}
				if (notification === "REMOTE_NOTIFICATION_ECHO_IN") {
					this.sendSocketNotification("REMOTE_NOTIFICATION_ECHO_OUT", payload);
				}
				if (notification === "USER_PRESENCE") {
					this.userPresence = payload;
				}
				/* API EXTENSION -- added v1.1.0 */
				if (notification === "REGISTER_API") {
					if ("module" in payload && Object.keys(this.externalApiRoutes).indexOf(payload.modules) === -1) {
						this.externalApiRoutes[payload.path] = payload;
					}
				}
			}
		},
		require("./API/api.js")
	)
);
