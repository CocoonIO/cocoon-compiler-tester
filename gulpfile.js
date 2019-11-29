"use strict";

const cocoonSDK = require("cocoon-cloud-sdk");
const fs = require("fs");
const gulp = require("gulp");
const path = require("path");
const readLine = require("readline");
const request = require("request");
const argv = require("yargs").argv;

const CLIENT_ID = argv.clientId || process.env.COCOON_CLIENT_ID || "babality";
const CLIENT_SECRET = argv.clientSecret || process.env.COCOON_CLIENT_SECRET || "fatality";
const USERNAME = argv.username || process.env.COCOON_USERNAME;
const PASSWORD = argv.password || process.env.COCOON_PASSWORD;
const REDIRECT_URL = argv.redirect || process.env.COCOON_REDIRECT;
const ENVIRONMENT = (argv.environment || process.env.COCOON_ENVIRONMENT || "production").toLowerCase();
const API_URL = ENVIRONMENT === "testing" ? "https://api-testing.cocoon.io/v1/" : undefined;
const OAUTH_URL = ENVIRONMENT === "testing" ? "https://cloud-testing.cocoon.io/oauth/" : undefined;
const DEFAULT_OUTPUT_DIR = "./out";
const DEFAULT_TEST_PROJECTS_PATH = "./tests";

const oAuth = new cocoonSDK.OAuth("password", CLIENT_ID, CLIENT_SECRET, REDIRECT_URL, OAUTH_URL);

let erredFlag = false;

// ================== FUNCTIONS ================== \\
/**
 * Logs the user in if not already logged in.
 * @param {string} username
 * @param {string} password
 * @return {Promise<void>}
 */
function login(username, password) {
	if (!cocoonSDK.CocoonAPI.checkAPIAccess()) {
		return oAuth.tokenExchangePassword(username, password)
		.then((result) => {
			cocoonSDK.CocoonAPI.setupAPIAccess(result.access_token, result.refresh_token, result.expires_in, API_URL);
			return undefined;
		})
		.catch((error) => {
			console.error("Login not successful.");
			console.trace(error);
			throw error;
		});
	} else {
		return Promise.resolve();
	}
}

/**
 * Downloads the URL as a file
 * @param {string} url
 * @param {string} outputPath
 * @return {Promise<void>}
 */
function downloadFile(url, outputPath) {
	const dir = path.dirname(outputPath);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir);
	}
	return new Promise((resolve, reject) => {
		const file = fs.createWriteStream(outputPath);
		const sendReq = request.get(url);
		sendReq.pipe(file);

		sendReq
		.on("response", (response) => {
			if (response.statusCode !== 200) {
				fs.unlink(outputPath);
				const error = new Error("Response status code was " + response.statusCode + ".");
				console.trace(error);
				reject(error);
			}
		})
		.on("error", function (error) {
			fs.unlink(outputPath);
			console.trace(error);
			reject(error);
		});

		file
		.on("finish", function () {
			file.close(() => {
				resolve();
			});
		})
		.on("error", function (error) {
			fs.unlink(outputPath);
			console.trace(error);
			reject(error);
		});
	});
}

/**
 * Gets the list of directories in a path
 * @param {string} dir
 * @returns {string[]}
 */
function getFolders(dir) {
	return fs.readdirSync(dir)
	.filter((file) => {
		return fs.statSync(path.join(dir, file)).isDirectory();
	});
}

// ====== Single Projects ====== \\
/**
 * Gets a project with the provided ID
 * @param {string} projectId
 * @return {Promise<Project>}
 */
function fetchProject(projectId) {
	return cocoonSDK.ProjectAPI.get(projectId)
	.catch((error) => {
		console.error("Project with ID: " + projectId + " couldn't be fetched.");
		console.trace(error);
		throw error;
	});
}

/**
 * Creates a new Cocoon Project from a zip file
 * @param {File} zipFile
 * @return {Promise<Project>}
 */
function createProject(zipFile) {
	return cocoonSDK.ProjectAPI.createFromZipUpload(zipFile)
	.catch((error) => {
		console.error("Project couldn't be created.");
		console.trace(error);
		throw error;
	});
}

/**
 * Updates the config.xml of the project with the one provided
 * @param {string} configXml
 * @param {Project} project
 * @return {Promise<void>}
 */
function updateConfig(configXml, project) {
	return project.updateConfigXml(configXml)
	.catch((error) => {
		console.error("Project config with ID: " + project.id + " couldn't be updated.");
		console.trace(error);
		throw error;
	});
}

/**
 * Updates the config.xml of the project with the same ID with the XML provided
 * @param {string} configXml
 * @param {string} projectId
 * @return {Promise<void>}
 */
function updateConfigWithId(configXml, projectId) {
	return fetchProject(projectId)
	.then((project) => {
		return updateConfig(configXml, project);
	})
	.catch((error) => {
		console.trace(error);
		throw error;
	});
}

/**
 * Deletes the project
 * @param {Project} project
 * @return {Promise<void>}
 */
function deleteProject(project) {
	return project.delete()
	.catch((error) => {
		console.error("Project with ID: " + project.id + " couldn't be deleted.");
		console.trace(error);
		throw error;
	});
}

/**
 * Deletes the project associated with the ID
 * @param {string} projectId
 * @return {Promise<void>}
 */
function deleteProjectWithId(projectId) {
	return fetchProject(projectId)
	.then(deleteProject)
	.catch((error) => {
		console.trace(error);
		throw error;
	});
}

/**
 * Creates a new Cocoon Project from a zip file and a config XML
 * @param {File} zipFile
 * @param {string} configXml
 * @return {Promise<Project>}
 */
function createProjectWithConfig(zipFile, configXml) {
	return createProject(zipFile)
	.then((project) => {
		return updateConfig(configXml, project)
		.then(() => {
			return project;
		})
		.catch((errorFromUpdate) => {
			deleteProject(project)
			.then(() => {
				console.error("The project with ID: " + project.id + " was not created because it wasn't possible to upload the custom XML.");
				throw errorFromUpdate;
			})
			.catch((errorFromDelete) => {
				console.error("The project with ID: " + project.id + " was created but it wasn't possible to upload the custom XML.");
				console.trace(errorFromDelete);
				throw errorFromDelete;
			});
		});
	})
	.catch((error) => {
		console.trace(error);
		throw error;
	});
}

/**
 * Uploads the zip file as the new source code of the project
 * @param {File} zipFile
 * @param {Project} project
 * @return {Promise<void>}
 */
function updateSource(zipFile, project) {
	return project.updateZip(zipFile)
	.catch((error) => {
		console.error("Project source with ID: " + project.id + " couldn't be updated.");
		console.trace(error);
		throw error;
	});
}

/**
 * Uploads the zip file as the new source code of the project with the same ID
 * @param {File} zipFile
 * @param {string} projectId
 * @return {Promise<void>}
 */
function updateSourceWithId(zipFile, projectId) {
	return fetchProject(projectId)
	.then((project) => {
		return updateSource(zipFile, project);
	})
	.catch((error) => {
		console.trace(error);
		throw error;
	});
}

/**
 * Places the project in the compilation queue
 * @param {Project} project
 * @return {Promise<void>}
 */
function compileProject(project) {
	return project.compile()
	.catch((error) => {
		console.error("Project " + project.name + " with ID: " + project.id + " couldn't be compiled.");
		console.trace(error);
		throw error;
	});
}

/**
 * Places the project associated with the ID in the compilation queue
 * @param {string} projectId
 * @return {Promise<void>}
 */
function compileProjectWithId(projectId) {
	return fetchProject(projectId)
	.then(compileProject)
	.catch((error) => {
		console.trace(error);
		throw error;
	});
}

/**
 * Waits for the project to finish compiling. Then calls the callback
 * @param {Project} project
 * @return {Promise<void>}
 */
function waitForCompletion(project) {
	return new Promise((resolve, reject) => {
		let warned = false;
		project.refreshUntilCompleted((completed, error) => {
			if (!error) {
				if (completed) {
					if (warned) {
						readLine.clearLine(process.stdout);  // clear "Waiting" line
						readLine.cursorTo(process.stdout, 0);  // move cursor to beginning of line
					}
					resolve();
				} else {
					if (!warned) {
						process.stdout.write("Waiting for " + project.name + " compilation to end ");
						warned = true;
					}
					process.stdout.write(".");
				}
			} else {
				reject(error);
			}
		});
	});
}

/**
 * Downloads the result of the latest platform compilation of the project
 * @param {Project} project
 * @param {string} platform
 * @param {string} outputDir
 * @return {Promise<void>}
 */
function downloadProjectCompilation(project, platform, outputDir) {
	return waitForCompletion(project)
	.then(() => {
		if (project.compilations[platform]) {
			if (project.compilations[platform].isReady()) {
				return downloadFile(project.compilations[platform].downloadLink,
					outputDir + "/" + project.name + "-" + platform + ".zip")
				.catch((error) => {
					console.error("Couldn't download " + platform + " compilation from project " + project.id + ".");
					console.trace(error);
					throw error;
				});
			} else if (project.compilations[platform].isErred()) {
				console.error("Couldn't download " + platform + " compilation from " + project.name + " project: " + project.id +
					". The compilation failed.");
				throw new Error("Compilation failed");
			} else {
				console.error("Couldn't download " + platform + " compilation from " + project.name + " project: " + project.id +
					". Status: " + project.compilations[platform].status + ".");
				throw new Error("Platform ignored");
			}
		} else {
			console.error("Couldn't download " + platform + " compilation from " + project.name + " project: " + project.id +
				". There was not a compilation issued for the platform.");
			throw new Error("No compilation available");
		}
	})
	.catch((error) => {
		console.trace(error);
		throw error;
	});
}

/**
 * Downloads the result of the latest platform compilation of the project with the ID provided
 * @param {string} projectId
 * @param {string} platform
 * @param {string} outputDir
 * @return {Promise<void>}
 */
function downloadProjectCompilationWithId(projectId, platform, outputDir) {
	return fetchProject(projectId)
	.then((project) => {
		return downloadProjectCompilation(project, platform, outputDir);
	})
	.catch((error) => {
		console.trace(error);
		throw error;
	});
}

/**
 * Downloads the results of the latest compilation of the project
 * @param {Project} project
 * @param {string} outputDir
 * @return {Promise<void>}
 */
function downloadProjectCompilations(project, outputDir) {
	const promises = [];
	for (const platform in project.compilations) {
		if (!project.compilations.hasOwnProperty(platform)) {
			continue;
		}
		promises.push(downloadProjectCompilation(project, platform, outputDir).catch(() => {
			return undefined;
		}));
	}
	return Promise.all(promises);
}

/**
 * Downloads the results of the latest compilation of the project with the ID provided
 * @param {string} projectId
 * @param {string} outputDir
 * @return {Promise<void>}
 */
function downloadProjectCompilationsWithId(projectId, outputDir) {
	return fetchProject(projectId)
	.then((project) => {
		return downloadProjectCompilations(project, outputDir);
	})
	.catch((error) => {
		console.trace(error);
		throw error;
	});
}

/**
 * Logs the result of the latest platform compilation of the project
 * @param {Project} project
 * @param {string} platform
 * @return {Promise<void>}
 */
function checkProjectCompilation(project, platform) {
	return waitForCompletion(project)
	.then(() => {
		if (project.compilations[platform]) {
			const compilation = project.compilations[platform];
			if (compilation.isReady()) {
				console.info(platform + " compilation from " + project.name + " project: " + project.id + " is completed.");
				return undefined;
			} else if (compilation.isErred()) {
				console.error(platform + " compilation from " + project.name + " project: " + project.id + " is erred.");
				return undefined;
			} else {
				console.error(platform + " compilation from " + project.name + " project: " + project.id +
					" was ignored. Status: " + compilation.status + ".");
				return undefined;
			}
		} else {
			console.error("There is no " + platform + " compilation from " + project.name + " project: " + project.id + ".");
			return undefined;
		}
	})
	.catch((error) => {
		console.trace(error);
		throw error;
	});
}

/**
 * Logs the result of the latest platform compilation of the project with the ID provided
 * @param {string} projectId
 * @param {string} platform
 * @return {Promise<void>}
 */
function checkProjectCompilationWithId(projectId, platform) {
	return fetchProject(projectId)
	.then((project) => {
		return checkProjectCompilation(project, platform);
	})
	.catch((error) => {
		console.trace(error);
		throw error;
	});
}

/**
 * Logs the results of the latest compilation of the project
 * @param {Project} project
 * @return {Promise<void>}
 */
function checkProjectCompilations(project) {
	return waitForCompletion(project)
	.then(() => {
		for (const platform in project.compilations) {
			if (!project.compilations.hasOwnProperty(platform)) {
				continue;
			}
			const compilation = project.compilations[platform];
			if (compilation.isReady()) {
				console.info(compilation.platform + " compilation from " + project.name + " project: " + project.id + " is completed.");
			} else if (compilation.isErred()) {
				erredFlag = true;
				console.error(compilation.platform + " compilation from " + project.name + " project: " + project.id + " is erred.");
				console.error("ERROR LOG of the " + compilation.platform + " platform:");
				console.error(compilation.error);
			} else {
				erredFlag = true;
				console.error(compilation.platform + " compilation from " + project.name + " project: " + project.id +
					" was ignored. Status: " + compilation.status + ".");
			}
		}
		return undefined;
	})
	.catch((error) => {
		console.trace(error);
		throw error;
	});
}

/**
 * Logs the results of the latest compilation of the project with the ID provided
 * @param {string} projectId
 * @return {Promise<void>}
 */
function checkProjectCompilationsWithId(projectId) {
	return fetchProject(projectId)
	.then((project) => {
		return checkProjectCompilations(project);
	})
	.catch((error) => {
		console.trace(error);
		throw error;
	});
}


// ====== Multiple Projects ====== \\
/**
 * Gets the whole list of projects of the logged user
 * @return {Promise<Project[]>}
 */
function fetchProjects() {
	return cocoonSDK.ProjectAPI.list()
	.then((projectList) => {
		return projectList;
	})
	.catch((error) => {
		console.error("Project list couldn't be fetched.");
		console.trace(error);
		throw error;
	});
}


// ================== GULP TASKS ================== \\

gulp.task("login", (done) => {
	if (USERNAME && PASSWORD) {
		login(USERNAME, PASSWORD)
		.then(done)
		.catch((error) => {
			done(error);
		});
	} else {
		if (!USERNAME) {
			console.error("Missing 'username' parameter.");
		}
		if (!PASSWORD) {
			console.error("Missing 'password' parameter.");
		}
		done(new Error("Missing parameters."));
	}
});

// ====== Single Projects ====== \\

gulp.task("createProject", ["login"], (done) => {
	if (argv.zipPath) {
		const file = fs.createReadStream(argv.zipPath);
		createProject(file)
		.then((project) => {
			console.info("Project " + project.name + " was created with ID: " + project.id + ".");
			done();
		})
		.catch((error) => {
			done(error);
		});
	} else {
		console.error("Missing 'zipPath' parameter.");
		done(new Error("Missing 'zipPath' parameter."));
	}
});

gulp.task("createProjectWithConfig", ["login"], (done) => {
	if (argv.zipPath && argv.configPath) {
		const zipFile = fs.createReadStream(argv.zipPath);
		const configXml = fs.readFileSync(argv.configPath, "utf8");
		createProjectWithConfig(zipFile, configXml)
		.then((project) => {
			console.info("Project " + project.name + " was created with ID: " + project.id + ".");
			done();
		})
		.catch(done);
	} else {
		if (!argv.zipPath) {
			console.error("Missing 'zipPath' parameter.");
		}
		if (!argv.configPath) {
			console.error("Missing 'configPath' parameter.");
		}
		done(new Error("Missing parameters."));
	}
});

gulp.task("updateSource", ["login"], (done) => {
	if (argv.projectId && argv.zipPath) {
		const file = fs.createReadStream(argv.zipPath);
		updateSourceWithId(file, argv.projectId)
		.then(() => {
			console.info("Project source with ID: " + argv.projectId + " was updated.");
			done();
		})
		.catch((error) => {
			done(error);
		});
	} else {
		if (!argv.projectId) {
			console.error("Missing 'projectId' parameter.");
		}
		if (!argv.zipPath) {
			console.error("Missing 'zipPath' parameter.");
		}
		done(new Error("Missing parameters."));
	}
});

gulp.task("updateConfig", ["login"], (done) => {
	if (argv.projectId && argv.configPath) {
		const configXml = fs.readFileSync(argv.configPath, "utf8");
		updateConfigWithId(configXml, argv.projectId)
		.then(() => {
			console.info("Project config with ID: " + argv.projectId + " was updated.");
			done();
		})
		.catch((error) => {
			done(error);
		});
	} else {
		if (!argv.projectId) {
			console.error("Missing 'projectId' parameter.");
		}
		if (!argv.configPath) {
			console.error("Missing 'configPath' parameter.");
		}
		done(new Error("Missing parameters."));
	}
});

gulp.task("delete", ["login"], (done) => {
	if (argv.projectId) {
		deleteProjectWithId(argv.projectId)
		.then(() => {
			console.info("Project with ID: " + argv.projectId + " was deleted.");
			done();
		})
		.catch((error) => {
			done(error);
		});
	} else {
		console.error("Missing 'projectId' parameter.");
		done(new Error("Missing 'projectId' parameter."));
	}
});

gulp.task("compile", ["login"], (done) => {
	if (argv.projectId) {
		compileProjectWithId(argv.projectId)
		.then(() => {
			console.info("Project with ID: " + argv.projectId + " will be compiled.");
			done();
		})
		.catch((error) => {
			done(error);
		});
	} else {
		console.error("Missing 'projectId' parameter.");
		done(new Error("Missing 'projectId' parameter."));
	}
});

gulp.task("downloadCompilation", ["login"], (done) => {
	if (argv.projectId) {
		const outputDir = argv.outputDir || DEFAULT_OUTPUT_DIR;
		if (argv.platform) {
			downloadProjectCompilationWithId(argv.projectId, argv.platform, outputDir)
			.then(() => {
				console.info("Downloaded " + argv.platform + " compilation from project with ID: " + argv.projectId + ".");
				done();
			})
			.catch((error) => {
				done(error);
			});
		} else {
			downloadProjectCompilationsWithId(argv.projectId, outputDir)
			.then(() => {
				console.info("Compilations for the project with ID: " + argv.projectId + " were downloaded.");
				done();
			})
			.catch((error) => {
				done(error);
			});
		}
	} else {
		console.error("Missing 'projectId' parameter.");
		done(new Error("Missing 'projectId' parameter."));
	}
});

gulp.task("checkCompilation", ["login"], (done) => {
	if (argv.projectId) {
		if (argv.platform) {
			checkProjectCompilationWithId(argv.projectId, argv.platform)
			.then(done)
			.catch((error) => {
				done(error);
			});
		} else {
			checkProjectCompilationsWithId(argv.projectId)
			.then(done)
			.catch((error) => {
				done(error);
			});
		}
	} else {
		console.error("Missing 'projectId' parameter.");
		done(new Error("Missing 'projectId' parameter."));
	}
});


// ====== Multiple Projects ====== \\

gulp.task("deleteAll", ["login"], (done) => {
	fetchProjects()
	.then((projectList) => {
		Promise.all(projectList.map((project) => {
			return deleteProject(project)
			.then(() => {
				console.info("The project " + project.name + " with ID: " + project.id + " was deleted.");
				return undefined;
			})
			.catch(() => {
				return undefined;
			});
		}))
		.then(() => {
			done();
		})
		.catch(done);
	})
	.catch((error) => {
		done(error);
	});
});

gulp.task("compileAll", ["login"], (done) => {
	fetchProjects()
	.then((projectList) => {
		return Promise.all(projectList.map((project) => {
			return compileProject(project)
			.then(() => {
				console.info("The project " + project.name + " with ID: " + project.id + " was placed in the compilation queue.");
				return undefined;
			})
			.catch(() => {
				return undefined;
			});
		}));
	})
	.then(() => {
		done();
	})
	.catch((error) => {
		done(error);
	});
});

gulp.task("checkAll", ["login"], (done) => {
	fetchProjects()
	.then((projectList) => {
		projectList.reduce((previousPromise, currentProject) => {
			return previousPromise.then(() => {
				return checkProjectCompilations(currentProject)
				.then(() => {
					console.log();
					return undefined;
				})
				.catch(() => {
					return undefined;
				});
			});
		}, Promise.resolve());
	})
	.catch((error) => {
		done(error);
	});
});


// ====== Custom Commands ====== \\

gulp.task("test", ["login"], (done) => {
	if (argv.testPath) {
		const testPath = argv.testPath[argv.testPath.length - 1] === "/" ? argv.testPath : argv.testPath + "/";
		const zipFile = fs.createReadStream(path.join(testPath, "source.zip"));
		const configXml = fs.readFileSync(path.join(testPath, "config.xml"), "utf8");
		createProjectWithConfig(zipFile, configXml)
		.then((project) => {
			console.info("Project " + project.name + " was created with ID: " + project.id + ".");
			const promises = [];
			const signingKeys = [];
			for (const platform of ["android", "ios", "osx", "ubuntu", "windows"]) {
				if (fs.existsSync(testPath + platform)) {
					const config = JSON.parse(fs.readFileSync(path.join(testPath, platform, "config.json"), "utf8"));
					let platformConfig;
					for (const platformObj of config.platforms) {
						if (platformObj.name === platform) {
							platformConfig = platformObj;
						}
					}

					if (platformConfig) {
						// Icon
						if (platformConfig.icon) {
							console.info("Using " + platformConfig.icon.url + " as icon for the " + platform + " platform of the project.");
							const iconFile = fs.createReadStream(path.join(testPath, platform, platformConfig.icon.url));
							promises.push(project.setIconBlob(iconFile, platform));
						}

						// Splash
						if (platformConfig.splash) {
							console.info("Using " + platformConfig.splash.url + " as splash for the " + platform + " platform of the project.");
							const splashFile = fs.createReadStream(path.join(testPath, platform, platformConfig.splash.url));
							promises.push(project.setSplashBlob(splashFile, platform));
						}

						// Signing Key
						if (platformConfig.key) {
							let promisePlatformSigningKey;
							switch (platform) {
								case "android": {
									console.info("Setting an Android Signing Key for the project.");
									const rndName = Math.random().toString(36).substr(2, 10);
									const keystoreFile = fs.createReadStream(path.join(testPath, platform, platformConfig.key.keystore));
									promisePlatformSigningKey = cocoonSDK.SigningKeyAPI.createAndroid(rndName, platformConfig.key.alias,
										keystoreFile, platformConfig.key.keystorepass, platformConfig.key.aliaspass);
									break;
								}
								case "ios": {
									console.info("Setting an iOS Signing Key for the project.");
									const rndName = Math.random().toString(36).substr(2, 10);
									const certFile = fs.createReadStream(path.join(testPath, platform, platformConfig.key.p12));
									const provProfFile = fs.createReadStream(path.join(testPath, platform, platformConfig.key.provisioning));
									promisePlatformSigningKey = cocoonSDK.SigningKeyAPI.createIOS(rndName, platformConfig.key.password, provProfFile, certFile);
									break;
								}
								case "osx": {
									console.info("Setting a MacOS Signing Key for the project.");
									const rndName = Math.random().toString(36).substr(2, 10);
									const certFile = fs.createReadStream(path.join(testPath, platform, platformConfig.key.p12));
									const provProfFile = fs.createReadStream(path.join(testPath, platform, platformConfig.key.provisioning));
									promisePlatformSigningKey = cocoonSDK.SigningKeyAPI.createMacOS(rndName, platformConfig.key.password, provProfFile, certFile);
									break;
								}
								case "windows": {
									console.info("Setting a Windows Signing Key for the project.");
									const rndName = Math.random().toString(36).substr(2, 10);
									const keystoreFile = fs.createReadStream(path.join(testPath, platform, platformConfig.key.packageCertificateKeyFile));
									promisePlatformSigningKey = cocoonSDK.SigningKeyAPI.createWindows(rndName, platformConfig.key.password,
										platformConfig.key.packageThumbprint, platformConfig.key.publisherId, keystoreFile);
									break;
								}
							}
							promises.push(new Promise((resolve, reject) => {
								promisePlatformSigningKey
								.then((platformSigningKey) => {
									signingKeys.push(platformSigningKey);
									project.assignSigningKey(platformSigningKey)
									.then(resolve)
									.catch(reject);
								})
								.catch(reject);
							}));
						}
					}
				}
			}
			Promise.all(promises)
			.then(() => {
				return compileProject(project);
			})
			.then(() => {
				console.info("Project with ID: " + project.id + " will be compiled.");
				return checkProjectCompilations(project);
			})
			.then(() => {
				return deleteProject(project);
			})
			.then(() => {
				return Promise.all(signingKeys.map((signingKey) => {
					return signingKey.delete();
				}));
			})
			.then(() => {
				console.info("Project with ID: " + project.id + " was deleted.");
				if (!erredFlag) {
					done();
				} else {
					done(new Error("The compilation failed."));
				}
			})
			.catch((error) => {
				console.trace(error);
				deleteProject(project)
				.then(() => {
					return Promise.all(signingKeys.map((signingKey) => {
						return signingKey.delete();
					}));
				})
				.then(() => {
					console.info("Project with ID: " + project.id + " was deleted.");
					if (!erredFlag) {
						done(error);
					} else {
						done(new Error("The compilation failed."));
					}
				})
				.catch(done);
			});
		})
		.catch(done);
	} else {
		console.error("Missing 'testPath' parameter.");
		done(new Error("Missing 'testPath' parameter."));
	}
});

gulp.task("uploadTests", ["deleteAll"], (done) => {
	const testProjectsPath = argv.testProjectsPath || DEFAULT_TEST_PROJECTS_PATH;
	const folders = [];
	const auxFolders = getFolders(testProjectsPath);
	for (let i = auxFolders.length - 1; i >= 0; i--) {
		const auxFolders2 = getFolders(testProjectsPath + "/" + auxFolders[i]);
		for (let j = auxFolders2.length - 1; j >= 0; j--) {
			folders.push(testProjectsPath + "/" + auxFolders[i] + "/" + auxFolders2[j]);
		}
	}
	Promise.all(folders.map((folder) => {
		const zipFile = fs.createReadStream(folder + "/source.zip");
		const configXml = fs.readFileSync(folder + "/config.xml");
		return createProjectWithConfig(zipFile, configXml)
		.then((project) => {
			console.info("Project " + project.name + " was created with ID: " + project.id + ".");
			return undefined;
		})
		.catch(() => {
			console.error("It was not possible to create a project from the path: '" + folder + "'.");
			return undefined;
		});
	}))
	.then(() => {
		done();
	})
	.catch((error) => {
		done(error);
	});
});
