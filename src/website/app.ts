/*
Copyright 2021 René Ferdinand Rivera Morell
Distributed under the Boost Software License, Version 1.0.
(See accompanying file LICENSE.txt or copy at
http://www.boost.org/LICENSE_1_0.txt)
*/

import express from "express";
import { Request, Response } from "express";
import { AddressInfo } from "net"
import fetch from "node-fetch";
import ExpressGA from "express-universal-analytics";
import mysql from "mysql";
import { OpenAPIBackend, Context as OpenAPIContext, Request as OpenAPIRequest } from "openapi-backend";

var db_configuration_path = null;
if (process.env.NODE_ENV === "production") {
	db_configuration_path = '/home/bfgbarbarian/.dbconf.mysql.barbarian.bfg.js';
} else {
	db_configuration_path = __dirname + '/../.dbconf.mysql.barbarian.bfg.js';
}
var db_configuration = require(db_configuration_path);

function get_server_name() {
	const server_name = /[/]([a-z]+[.]bfgroup[.]xyz)/g.exec(__dirname);
	if (server_name != null) {
		return server_name[1];
	}
	else {
		return "barbarian.bfgroup.xyz";
	}
}

const server_name = get_server_name();

console.log('Server Name:', server_name);

/*************************************************************************
 * Conan Server V1..
 */

var epv1 = express.Router();

/*
	Not implemented end points.
*/
async function epv1_noop(req: Request, res: Response) {
	send_json(res, {});
}
epv1.get('/conans/*/search', epv1_noop);
epv1.get('/conans/*/upload_urls', epv1_noop);

/*
	Informational, I'm here, end point.
*/
async function epv1_ping(req: Request, res: Response) {
	send_json(res, {
		"hello": "Welcome Barbarians!",
		"version": process.env.npm_package_version
	});
}
epv1.get('/ping', epv1_ping);

/*
	The root search is the same as the v2 search.
*/
async function epv1_search(req: Request, res: Response) {
	return await epv2_search(req, res);
}
epv1.get('/conans/search', epv1_search);

/*
	Returns the snapshot of the recipe files for the specified Conan recipe. The snapshot is a list of filenames with their associated md5 hash.

	https://center.conan.io/v1/conans/lyra/1.5.1/_/_
	{
		"conan_export.tgz" : "feee725dad53a465ab74eda1bfe98e81",
		"conanmanifest.txt" : "a9bac22e1071021a30b78142a4b4843c",
		"conanfile.py" : "c8d339a433f888a6217afcaeb744b36a"
	}
*/
async function epv1_snapshot(req: Request, res: Response) {
	var recipe_data_url = await fetch_github_recipe_data_url_latest(req, res);
	if (recipe_data_url != null) {
		var snapshot = await fetch_json(recipe_data_url + "/snapshot.json");
		if (snapshot != null) {
			return send_json(res, snapshot);
		}
		else {
			send_404(res);
			return;
		}
	}
}
epv1.get('/conans/:package_name/:package_version/:package_username/:package_channel', epv1_snapshot);

/*
	List of recipe filenames with their associated download URLs. 

	https://center.conan.io/v1/conans/lyra/1.5.1/_/_/digest
	{
	"conanmanifest.txt" : "https://center.conan.io/artifactory/api/conan/conan-center/v1/files/_/lyra/1.5.1/_/4fb6e3981f4b64ebe13aa667d4fc1284/export/conanmanifest.txt"
	}
*/
async function epv1_digest(req: Request, res: Response) {
	var recipe_data_url = await fetch_github_recipe_data_url_latest(req, res);
	if (recipe_data_url != null)
		send_json(res, {
			"conanmanifest.txt": recipe_data_url + "/files/conanmanifest.txt"
		});
}
epv1.get('/conans/:package_name/:package_version/:package_username/:package_channel/digest', epv1_digest);

/*
	Returns a list of recipe filenames with their associated download URLs. These are the corresponding URLs for the snapshot items.

	https://center.conan.io/v1/conans/lyra/1.5.1/_/_/download_urls
	{
	"conan_export.tgz" : "https://center.conan.io/artifactory/api/conan/conan-center/v1/files/_/lyra/1.5.1/_/4fb6e3981f4b64ebe13aa667d4fc1284/export/conan_export.tgz",
	"conanmanifest.txt" : "https://center.conan.io/artifactory/api/conan/conan-center/v1/files/_/lyra/1.5.1/_/4fb6e3981f4b64ebe13aa667d4fc1284/export/conanmanifest.txt",
	"conanfile.py" : "https://center.conan.io/artifactory/api/conan/conan-center/v1/files/_/lyra/1.5.1/_/4fb6e3981f4b64ebe13aa667d4fc1284/export/conanfile.py"
	}
	> tar tvf conan_export.tar
	-rw-r--r-- 0/0             157 1969-12-31 18:00 conandata.yml
*/
async function epv1_download_urls(req: Request, res: Response) {
	var latest_revision = await fetch_github_recipe_latest_revision(req, res);
	if (latest_revision == null) {
		send_404(res);
		return null;
	}
	var files = await fetch_json(get_raw_github_recipe_data_url(req) + "/" + latest_revision + "/files.json");
	if (files == null) {
		send_404(res);
		return null;
	}
	var downloads: { [file: string]: string } = {};
	for (var file in files.files) {
		downloads[file] = get_self_github_recipe_files_url(req, latest_revision) + "/" + file;
	}
	return send_json(res, downloads);
}
epv1.get('/conans/:package_name/:package_version/:package_username/:package_channel/download_urls', epv1_download_urls);

/*
	Fallback.
*/
async function epv1_hello(req: Request, res: Response) {
	send_json(res, {
		"hello": "Welcome Barbarians!",
		"version": process.env.npm_package_version
	});
}
epv1.get('*', epv1_hello);

/*************************************************************************
 * Conan Server V2..
 */

var epv2 = express.Router();

/*
	Package search.

	https://center.conan.io/v2/conans/search?q=zlib%2F%2A
	{
	"results" : [ "zlib/1.2.11@_/_", "zlib/1.2.8@_/_" ]
	}
*/
async function epv2_search(req: Request, res: Response) {
	var query = req.query.q?.toString();
	query = query?.replace(/_/g, '\\_');
	query = query?.replace(/%/g, '\\%');
	query = query?.replace(/[*]/g, '%');
	var binary = "";
	if (('ignorecase' in req.query) && req.query.ignorecase == "False") {
		binary = "BINARY";
	}
	var sql = mysql.format(
		"SELECT"
		+ " CONCAT(name, '/', version, '@', identity) as ref"
		+ " FROM barbarian_package"
		+ " WHERE packager = 'conan'"
		+ " AND CONCAT(name,'/',version) LIKE " + binary + " ?"
		+ " ORDER BY name"
		+ " LIMIT 100",
		[query]);
	db().query(sql,
		function (error: any, results: Array<any>, fields: any) {
			var refs: string[] = [];
			if (error) {
				console.error("[ERROR] search failed: " + error);
			} else {
				refs = results.map(row => row.ref);
			}
			send_json(res, { "results": refs });
		});
}
epv2.get('/conans/search', epv2_search);

/*
	Information on the latest recipe revision.

	https://center.conan.io/v2/conans/lyra/1.5.1/_/_/latest
	{
	"revision" : "4fb6e3981f4b64ebe13aa667d4fc1284",
	"time" : "2020-10-20T03:02:46.710+0000"
	}
*/
async function epv2_latest(req: Request, res: Response) {
	var recipe_data_url = get_raw_github_recipe_data_url(req);
	var latest = await fetch_json(recipe_data_url + "/latest.json");
	if (latest != null) {
		return send_json(res, latest);
	}
	else {
		send_404(res);
		return null;
	}
}
epv2.get('/conans/:package_name/:package_version/:package_username/:package_channel/latest', epv2_latest);

/*
	List of export files in the revision.

	https://center.conan.io/v2/conans/lyra/1.5.1/_/_/revisions/4fb6e3981f4b64ebe13aa667d4fc1284/files
	{
		"files" : {
			"conan_export.tgz" : { },
			"conanmanifest.txt" : { },
			"conanfile.py" : { }
		}
	}
*/
async function epv2_files(req: Request, res: Response) {
	var recipe_data_url = get_raw_github_recipe_data_url(req);
	var files = await fetch_json(recipe_data_url + "/" + req.params.revision + "/files.json");
	if (files != null) {
		return send_json(res, files);
	}
	else {
		send_404(res);
		return null;
	}
}
epv2.get('/conans/:package_name/:package_version/:package_username/:package_channel/revisions/:revision/files', epv2_files);

/*
	File download.
*/
async function epv2_files_download(req: Request, res: Response) {
	if (req.params.file === "conan_export.tgz") {
		track_download(req);
	}
	var recipe_data_url = get_raw_github_recipe_data_url(req);
	res.redirect(recipe_data_url + "/" + req.params.revision + "/files/" + req.params.file);
}
epv2.get('/conans/:package_name/:package_version/:package_username/:package_channel/revisions/:revision/files/:file', epv2_files_download);

/*
	Everything else.. 404.
*/
async function epv2_error(req: Request, res: Response) {
	send_404(res);
}
epv2.get('*', epv2_error);

/*************************************************************************
 * Corum API..
 */

var corum_api_path = __dirname + '/static/corum.json';
if (process.env.NODE_ENV === "production") {
	corum_api_path = '/home/bfgbarbarian/' + server_name + '/static/corum.json';
}
console.log("[INFO] corum_api_path = " + corum_api_path);

const corum_api = new OpenAPIBackend({ definition: corum_api_path });
corum_api.register({
	meta: corum_meta
});

async function corum_meta(context: OpenAPIContext, req: Request, res: Response) {
	var info = {
		"api_version": context.api.definition.info.version,
		"server_version": process.env.npm_package_version,
		"server_name": server_name,
		"stability": "dev"
	};
	if (server_name == "barbarian.bfgroup.xyz") {
		info.stability = "release";
	}
	return send_json(res, info);
}

/*************************************************************************
 * Utility..
 */

function get_raw_github_recipe_data_url(req: Request) {
	return "https://raw.githubusercontent.com/"
		+ req.params.package_username + "/" + req.params.package_channel
		+ "/barbarian/"
		+ req.params.package_name + "/" + req.params.package_version;
}

function get_self_github_recipe_files_url(req: Request, rev: string) {
	return get_barbarian_base_url(req)
		+ "/github/v2/conans"
		+ "/" + req.params.package_name + "/" + req.params.package_version
		+ "/" + req.params.package_username + "/" + req.params.package_channel
		+ "/revisions/" + rev + "/files";
}

function send_json(res: Response, data: object) {
	res.setHeader("Content-Type", "application/json");
	res.status(200).send(Buffer.from(JSON.stringify(data)));
}

function send_404(res: Response) {
	res.setHeader("Content-Type", "application/json");
	res.status(404).send(Buffer.from(JSON.stringify({
		'errors': [{
			'status': 404,
			'message': 'Not Found'
		}]
	})));
}

async function fetch_json(url: string) {
	try {
		console.log("[INFO] fetch_json: " + url);
		const response = await fetch(url);
		if (response.ok)
			return await response.json();
		else
			return null;
	} catch (error) {
		console.log(error);
	};
}

async function fetch_self_json(req: Request, path: string) {
	return fetch_json(get_barbarian_base_url(req) + path);
}

async function fetch_github_recipe_latest_revision(req: Request, res: Response) {
	var recipe_data_url = get_raw_github_recipe_data_url(req);
	var latest = await fetch_json(recipe_data_url + "/latest.json");
	if (latest != null) {
		return latest["revision"];
	}
	else {
		return null;
	}
}

async function fetch_github_recipe_data_url_latest(req: Request, res: Response) {
	var latest_revision = await fetch_github_recipe_latest_revision(req, res);
	if (latest_revision != null) {
		return get_raw_github_recipe_data_url(req) + "/" + latest_revision;
	}
	else {
		send_404(res);
		return null;
	}
}

var db_connection: mysql.Connection;

function db() {
	if (db_connection == null) {
		db_connection = mysql.createConnection(db_configuration);
	}
	return db_connection;
}

/*************************************************************************
 * Server..
 */

function log(req: Request, res: Response, next: any) {
	console.log("[INFO] url = " + get_barbarian_request_url(req) + " params = " + JSON.stringify(req.params) + " query = " + JSON.stringify(req.query));
	console.log("[INFO] remote = " + (
		req.connection.remoteAddress
		|| req.socket.remoteAddress
		|| req.connection.remoteAddress
		|| (<string>req.headers['x-forwarded-for']).split(',').pop()
	));
	console.log("[INFO] UA = " + (<string>req.headers['user-agent']));
	next();
}

function capabilities(req: Request, res: Response, next: any) {
	res.setHeader("X-Conan-Server-Capabilities", "revisions");
	// res.setHeader("X-Conan-Server-Capabilities", "");
	if (typeof (process.env.npm_package_version) == 'string')
		res.setHeader("X-Barbarian-Server-Version", process.env.npm_package_version);
	next();
}

function track_download(req: Request) {
	db().query(
		'INSERT INTO barbarian_track SET ?',
		{
			package_name: req.params.package_name,
			package_version: req.params.package_version,
			package_username: req.params.package_username,
			package_channel: req.params.package_channel,
			revision: req.params.revision,
			dp: req.originalUrl,
			ua: <string>req.headers['user-agent'],
			uip: req.connection.remoteAddress
				|| req.socket.remoteAddress
				|| (<string>req.headers['x-forwarded-for']).split(',').pop()
		},
		function (error: any, results: any, fields: any) {
			if (error) {
				console.error("[ERROR] track_download failed: " + error);
				db().end();
			}
		});
}

function get_barbarian_base_url(req: Request) {
	const { address, family, port } = server.address() as AddressInfo;
	if (address != undefined) {
		return req.protocol + "://" + address + ':' + port;
	}
	else {
		return "https://" + server_name;
	}
}

function get_barbarian_request_url(req: Request) {
	return get_barbarian_base_url(req) + req.url;
}

const app = express();
app.use(ExpressGA('UA-15160295-7'));
app.use(express.json());
app.use(log);
app.use(capabilities);
app.use("/github/v1", epv1);
app.use("/github/v2", epv2);
app.use("/corum", (req: Request, res: Response) => corum_api.handleRequest(req as OpenAPIRequest, req, res));

// async function ep_welcome(req: Request, res: Response) {
// 	res.send('Welcome Barbarians!');
// }
// app.get('*', ep_welcome);
app.use(express.static(__dirname + '/static'));

const server = app.listen(5000, '0.0.0.0', () => {
	const { address, family, port } = server.address() as AddressInfo;
	console.log('Server listening on:', 'http://' + address + ':' + port, 'family is', family);
});

