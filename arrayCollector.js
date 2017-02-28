var cloudscraper = require('cloudscraper');
var readline = require('readline');
var Anime = require('anime-scraper').Anime;
var cheerio = require('cheerio');
var fs = require('fs');
var https = require('https');
var fileSanitizer = require('sanitize-filename');
var path = require('path');
var async = require('async');
var request = require('request');
var child_process = require('child_process');
var storage = require('node-persist');
var sleep = require('sleep');

Anime.setDelay(10000);
var basePath = process.argv[3];
var maxProcesses = process.argv[4] || 5;
var animeArray = [];
var iterator = 0;
var runningTemp = false;
storage.initSync();

if(storage.getItemSync('animeArray') != null && storage.getItemSync('animeArray') != undefined && storage.getItemSync('animeArray') != [] && storage.getItemSync('animeArray').length != 0) {
	process.stdout.write("Found partial list, downloading...");
	spawnProcesses(function() {
		storage.clearSync();
		storage.setItemSync('animeArray', []);
		process.stdout.write("Finished partial list download!");
		gatherArray(false, function() {
			process.stdout.write("Finished cached list download!");
			process.stdout.write("Starting noCache search!");
			gatherArray(true, function() {
				process.stdout.write("No more new episodes found!");
				process.exit();
			})
		});
	});
} else {
	storage.setItemSync('animeArray', []);
	process.stdout.write("No partial list found");
	gatherArray(false, function() {
		process.stdout.write("Finished cached list download!");
		process.stdout.write("Starting noCache search!");
		gatherArray(true, function() {
			process.stdout.write("No more new episodes found!");
			process.exit();
		})
	});
}

function gatherArray(noCache, topCallback) {
	cloudscraper.get(process.argv[2], function(err, res, body) {
		if(err) {
			process.exit(1);
		} else {
			const $ = cheerio.load(body);
			const result = $(".trAnime td .aAnime").map((i, element) => ({
				url: $(element).attr('href')
			})).get();

			async.eachSeries(result, function(url, callback) {
				process.stdout.write("\nAdding http://kissanime.ru" + url.url + " to job list!");
				Anime.fromUrl("http://kissanime.ru" + url.url).then(function(anime) {
					dirName = fileSanitizer(anime.name);
					if(!fs.existsSync(path.join(basePath, dirName))) {
						fs.mkdirSync(path.join(basePath, dirName));
					}

					if(storage.getItemSync('animeArray').length > maxProcesses*2 && runningTemp == false) {
						runningTemp = true
						process.stdout.write("Running downloader halfway");
						var tempArray = storage.getItemSync('animeArray');
						storage.setItemSync('animeArray', []);

						spawnProcesses(tempArray, function() {
							process.stdout.write("Done running partial downloads...");

							runningTemp = false;
						});
					}

					if(fs.existsSync(path.join(basePath, dirName, dirName + " Episode 001.mp4")) && noCache == false) {
						process.stdout.write("Skipping " + dirName + " for now, because episode 1 exists");
						callback();
					} else  {
						async.eachSeries(anime.episodes, function(epi, cb) {
							epi.fetch().then(function(episode) {
								episodeName = fileSanitizer(episode.name);
								if(!fs.existsSync(path.join(basePath, dirName, episodeName + ".mp4"))) {
									process.stdout.write("Adding " + episodeName + " to downloadList");
									var temp = storage.getItemSync('animeArray');
									temp.push({
										url: episode.video_links[0],
										fileName: path.join(basePath, dirName, episodeName + ".mp4")
									});
									storage.setItemSync('animeArray', temp);
									cb(null);
								} else {
									process.stdout.write("Not adding " + episodeName + " because it already exists!");
									cb(null);
								}
							}, function(err) {
								process.stdout.write("Could not establish connection to kissanime!");
							});
						}, function(err) {
							callback(null);
						})
					}
				})
			}, function(err) {
				process.stdout.write("Indexed all anime, waiting for download threads to free up")
				while(runningTemp) {
					sleep.sleep(10);
				}
				process.stdout.write("Download threads free, spawning download processes now!");
				spawnProcesses(null, function() {
					storage.clearSync();
					storage.setItemSync('animeArray', []);
					process.stdout.write("Processed finished with " + iterator + " fails");
					topCallback();
				});
			});
		}
	});
}

function spawnProcesses(downloadArray, callback) {
	if(downloadArray == null) {
		downloadArray = storage.getItemSync('animeArray');
	}
	async.eachLimit(downloadArray, maxProcesses, function(animeObject, callback) {
		if(!fs.existsSync(animeObject.fileName)) {
			thread = child_process.spawn('node', ['singleDownloader.js', animeObject.url.url, animeObject.fileName]);
			thread.stdout.on('data', (data) => {
				process.stdout.write(data.toString());
			});

			thread.stderr.on('data', (data) => {
				process.stdout.write(data.toString());
				iterator++;
			});

			thread.on('close', (code) => {
				if(code == 0) {
					callback();
				} else if(code == 1) {
					iterator++;
				}
			});			
		} else {
			callback();
		}
	}, function(err) {
		callback();
	});
}