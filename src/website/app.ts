/*
Copyright 2021-2022 René Ferdinand Rivera Morell
Distributed under the Boost Software License, Version 1.0.
(See accompanying file LICENSE.txt or copy at
http://www.boost.org/LICENSE_1_0.txt)
*/

import express from "express";
import { Request, Response } from "express";
import { AddressInfo } from "net"
import fetch from "node-fetch";
import ExpressGA from "express-universal-analytics";
import mysql from "mysql2/promise";
import { Pool as dbPool, PoolConnection as dbConnection } from "mysql2/promise";
import { RowDataPacket as dbRow, ResultSetHeader as dbResult } from "mysql2";
import { OpenAPIBackend, Context as OpenAPIContext, Request as OpenAPIRequest } from "openapi-backend";

/*************************************************************************
 * Server name.. We need the server name in both composing self URLs and
 * in reading "configuration" files. The server name turns out to be
 * rather tricky to compute as there are various contexts: localhost
 * with variant=release build, localhost with variant-debug build,
 * deployed production, and deployed development. In most cases we attempt
 * to use the directory name as we control that both locally and deployed.
 * But fall back to the sensible production name.
 */

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
 * Identify the two main modes of operation for the server. Production is
 * what's released to "barbarian.bfgroup.xyz". And development will be
 * anything else, like local dev or the jenna test server.
 */

function is_production() {
	return process.env.NODE_ENV === "production" || server_name === "barbarian.bfgroup.xyz";
}

function is_test() {
	return process.env.NODE_ENV === "test" || server_name === "jenna.bfgroup.xyz";
}

function is_dev() {
	return process.env.NODE_ENV === "debug" || (!is_production() && !is_test());
}

/*************************************************************************
 * Configuration data we fetch externally. It means we have to compute
 * where that data is. As the location depends on which environment we are
 * running as.
 */
var db_configuration: any;
var app_package: any;

if (is_dev()) {
	db_configuration = require(__dirname + '/../.dbconf.dev.js');
	app_package = require(__dirname + '/../package.json');
} else if (is_test()) {
	db_configuration = require('/home/bfgbarbarian/.dbconf.test.js');
	app_package = require('/home/bfgbarbarian/' + server_name + '/package.json');
} else if (is_production()) {
	db_configuration = require('/home/bfgbarbarian/.dbconf.production.js');
	app_package = require('/home/bfgbarbarian/' + server_name + '/package.json');
}

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
		"version": app_package.version
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
			return send_404(res);
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
		return send_json(res, {
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
		return send_404(res);
	}
	var files = await fetch_json(get_raw_github_recipe_data_url(req) + "/" + latest_revision + "/files.json");
	if (files == null) {
		return send_404(res);
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
	return send_json(res, {
		"hello": "Welcome Barbarians!",
		"version": app_package.version
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
	try {
		var connection = undefined;
		try {
			connection = await db();
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
			const [results,] = await connection.query<dbRow[]>(sql);
			var refs: string[] = [];
			for (const row of results)
				refs = results.map(row => row.ref);
			return send_json(res, { "results": refs });
		} finally {
			db_release(connection);
		}
	} catch (e) {
		return send_error(res, 500, "[ERROR] search failed: " + e);
	}
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
		return send_404(res);
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
		return send_404(res);
	}
}
epv2.get('/conans/:package_name/:package_version/:package_username/:package_channel/revisions/:revision/files', epv2_files);

/*
	File download.
*/
async function epv2_files_download(req: Request, res: Response) {
	if (req.params.file === "conan_export.tgz") {
		await track_download(req, res);
	}
	var recipe_data_url = get_raw_github_recipe_data_url(req);
	res.redirect(recipe_data_url + "/" + req.params.revision + "/files/" + req.params.file);
}
epv2.get('/conans/:package_name/:package_version/:package_username/:package_channel/revisions/:revision/files/:file', epv2_files_download);

/*
	Everything else.. 404.
*/
async function epv2_error(req: Request, res: Response) {
	return send_404(res);
}
epv2.get('*', epv2_error);

/*************************************************************************
 * Corum API..
 */

var corum_api_path;
if (is_dev()) {
	corum_api_path = __dirname + '/static/corum.json';
}
else {
	corum_api_path = '/home/bfgbarbarian/' + server_name + '/static/corum.json';
}
console.log("[INFO] corum_api_path = " + corum_api_path);

const corum_api = new OpenAPIBackend({ definition: corum_api_path });
corum_api.register({
	notFound: corum_not_found,
	postResponseHandler: corum_validate_response,
	validationFail: corum_validation_fail,
	meta: corum_meta,
	get_product_min_by_id: corum_product_min_by_id,
	get_product_full_by_id: corum_product_full_by_id,
	product_search: corum_product_search
});

function corum_handle_request(req: Request, res: Response) {
	return corum_api.handleRequest(req as OpenAPIRequest, req, res);
}

async function corum_validate_response(context: OpenAPIContext, req: Request, res: Response) {
	if (is_dev() && context.operation) {
		const valid = context.api.validateResponse(
			(typeof context.response) === "object"
				? context.response
				: JSON.parse(context.response),
			context.operation)
		if (valid.errors) {
			console.log(
				"[ERROR] Response validation failed for operation '" + context.operation.operationId + "':\n" + JSON.stringify(valid.errors, null, 2)
				+ "\nResponse:\n" + context.response
			);
		}
	}
}

async function corum_validation_fail(context: OpenAPIContext, req: Request, res: Response) {
	var errors = context.validation.errors?.map(error => error.message);
	return send_error(res, 400, "Failed validation: " + errors?.join(", ") + ".");
}

async function corum_not_found(context: OpenAPIContext, req: Request, res: Response) {
	return send_404(res);
}

type CorumMeta = {
	api_version: string;
	server_version: string;
	server_name: string;
	stability: string;
};

async function corum_meta(context: OpenAPIContext, req: Request, res: Response) {
	var info: CorumMeta = {
		api_version: context.api.definition.info.version,
		server_version: app_package.version,
		server_name: server_name,
		stability: "dev"
	};
	if (server_name == "barbarian.bfgroup.xyz") {
		info.stability = "release";
	}
	return send_json(res, info);
}

type CorumProductMin = {
	uuid: string;
	name: string;
	description_brief: string;
	topic: [];
	license: string;
};

function corum_result_to_product_min(result: any): CorumProductMin {
	return {
		uuid: result.uuid,
		name: result.name,
		description_brief: (result.description_brief ?? ""),
		topic: (result.topic ?? "").split(" "),
		license: (result.license ?? "")
	};
}

async function corum_product_min_by_id(context: OpenAPIContext, req: Request, res: Response) {
	try {
		var connection = undefined;
		try {
			connection = await db();
			const [results,] = await connection.query<dbRow[]>(
				"SELECT"
				+ " uuid, name, description_brief, topic, license"
				+ " FROM barbarian_project"
				+ " WHERE uuid = ?"
				+ " LIMIT 1",
				[context.request.params.product_uuid]
			);
			if (results.length < 1) {
				return send_404(res);
			} else {
				return send_json(res, corum_result_to_product_min(results[0]));
			}
		} finally {
			db_release(connection);
		}
	} catch (e) {
		return send_error(res, 500, "[ERROR] " + e);
	}
}

type CorumProductFull = {
	uuid: string;
	name: string;
	description_brief: string;
	topic: [];
	license: string;
	updated?: string;
	homepage?: string;
	author?: string;
	description_full?: object;
	info?: any;
};

async function corum_product_full_by_id(context: OpenAPIContext, req: Request, res: Response) {
	try {
		var connection = undefined;
		try {
			connection = await db();
			const [results,] = await connection.query<dbRow[]>(
				"SELECT"
				+ " uuid, name, description_brief, topic, license, updated, info"
				+ " FROM barbarian_project"
				+ " WHERE uuid = ?"
				+ " LIMIT 1",
				[context.request.params.product_uuid]
			);
			if (results.length < 1) {
				return send_404(res);
			} else {
				var result: CorumProductFull = {
					uuid: results[0].uuid,
					name: results[0].name,
					description_brief: (results[0].description_brief ?? ""),
					topic: (results[0].topic ?? "").split(" "),
					license: (results[0].license ?? ""),
					updated: results[0].updated,
					homepage: results[0].info?.homepage,
					author: results[0].info?.author
				};
				var info = JSON.parse(results[0].info);
				if (info && info.barbarian !== undefined && info.barbarian.description !== undefined) {
					result.description_full = {
						"text": info.barbarian.description.text,
						"format": info.barbarian.description.format
					};
					delete info["barbarian"];
					delete info["name"];
					delete info["topics"];
					delete info["license"];
					delete info["description"];
					result.info = info;
				}
				return send_json(res, result);
			}
		} finally {
			db_release(connection);
		}
	} catch (e) {
		return send_error(res, 500, "[ERROR] " + e);
	}
}

type CorumProductMinList = {
	start: number;
	count: number;
	total: number;
	products: CorumProductMin[];
};

function corum_product_search_build_query(req: Request, for_count: boolean): string {
	var match_fields = [];
	switch (req.query?.in ?? "all") {
		case "topic": match_fields = ["topic"]; break;
		case "name": match_fields = ["name"]; break;
		default: match_fields = ["name", "description_brief", "topic"]; break;
	}
	var query = "SELECT"
		+ (for_count
			? " COUNT(*) as total"
			: " uuid, name, description_brief, topic, license")
		+ " FROM barbarian_project"
		+ " WHERE"
		+ " MATCH(" + match_fields.join(",") + ")"
		+ " AGAINST (? IN NATURAL LANGUAGE MODE)"
		+ (for_count
			? ""
			: " LIMIT ?,100")
		;
	return query;
}

async function corum_product_search(context: OpenAPIContext, req: Request, res: Response) {
	try {
		var connection = undefined;
		try {
			connection = await db();
			var match = ((req.query.words ?? "") as string).replace('|', ' ');
			var offset = Number.parseInt((req.query.start ?? "0") as string);
			console.log("[INFO] words: " + match);
			var query_data = corum_product_search_build_query(req, false);
			var query_count = corum_product_search_build_query(req, true);
			const [results,] = await connection.query<dbRow[]>(query_data, [match, offset]);
			if (results.length < 1) {
				return send_404(res);
			}
			const [count,] = await connection.query<dbRow[]>(query_count, [match]);
			if (count.length < 1) {
				return send_404(res);
			}
			var products: CorumProductMin[] = results.map(result => {
				return corum_result_to_product_min(result);
			});
			var info: CorumProductMinList = {
				start: offset,
				count: products.length,
				total: count[0].total,
				products: products
			};
			return send_json(res, info);
		} finally {
			db_release(connection);
		}
	} catch (e) {
		return send_error(res, 500, "[ERROR] " + e);
	}
}

/*************************************************************************
 * Utility..
 */

function get_raw_github_recipe_data_url(req: Request): string {
	return "https://raw.githubusercontent.com/"
		+ req.params.package_username + "/" + req.params.package_channel
		+ "/barbarian/"
		+ req.params.package_name + "/" + req.params.package_version;
}

function get_self_github_recipe_files_url(req: Request, rev: string): string {
	return get_barbarian_base_url(req)
		+ "/github/v2/conans"
		+ "/" + req.params.package_name + "/" + req.params.package_version
		+ "/" + req.params.package_username + "/" + req.params.package_channel
		+ "/revisions/" + rev + "/files";
}

function send_json(res: Response, data: object, status?: number): string {
	res.setHeader("Content-Type", "application/json");
	var json_string = JSON.stringify(data);
	res.status(status ? status : 200).send(Buffer.from(json_string));
	return json_string;
}

function send_error(res: Response, status: number, message: string): string {
	return send_json(
		res,
		{
			'status': status,
			'message': message
		},
		status);
}

function send_404(res: Response): string {
	return send_error(res, 404, "Not Found");
}

async function fetch_json(url: string): Promise<any> {
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

async function fetch_self_json(req: Request, path: string): Promise<any> {
	return fetch_json(get_barbarian_base_url(req) + path);
}

async function fetch_github_recipe_latest_revision(req: Request, res: Response): Promise<any> {
	var recipe_data_url = get_raw_github_recipe_data_url(req);
	var latest = await fetch_json(recipe_data_url + "/latest.json");
	if (latest != null) {
		return latest["revision"];
	}
	else {
		return null;
	}
}

async function fetch_github_recipe_data_url_latest(req: Request, res: Response): Promise<any> {
	var latest_revision = await fetch_github_recipe_latest_revision(req, res);
	if (latest_revision != null) {
		return get_raw_github_recipe_data_url(req) + "/" + latest_revision;
	}
	else {
		return send_404(res);
	}
}

/*************************************************************************
 * MySQL database connections. Each call to `db()` will return a new
 * connection. When done with the connection `db_release()` will make it
 * available for the next caller.`
 */

var db_pool: dbPool;

async function db(): Promise<dbConnection> {
	try {
		if (db_pool == null) {
			db_configuration.namedPlaceholders = true;
			db_pool = mysql.createPool(db_configuration);
		}
		return await db_pool.getConnection();
	} finally {
	}
}

function db_release(connection?: dbConnection) {
	if (connection) {
		connection.release();
	}
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
	if (typeof (app_package.version) == 'string')
		res.setHeader("X-Barbarian-Server-Version", app_package.version);
	next();
}

async function ensure_available(req: Request, res: Response, next: any) {
	var is_available = true;
	var reason = "Server is not in service.";
	try {
		var connection = undefined;
		try {
			connection = await db();
			var [results,] = await connection.query<dbRow[]>(
				"SELECT value FROM barbarian_meta WHERE id = 'status'");
			if (results.length > 0) {
				console.log("[INFO] ensure_available status = " + results[0].value);
				var status = (typeof results[0].value === 'string')
					? JSON.parse(results[0].value) : results[0].value;
				is_available = status.in_service;
				reason = "Server is not in service for maintenance.";
			}
		} finally {
			db_release(connection);
		}
	} catch (e) {
		is_available = false;
		if (!is_production()) throw e;
	}
	if (!is_available) {
		res.setHeader("Retry-After", 60 * 60);
		send_error(res, 503, "[ERROR] " + reason);
	}
	else {
		next();
	}
}

async function track_download(req: Request, res: Response) {
	try {
		var connection = undefined;
		try {
			connection = await db();
			await connection.execute(
				'INSERT INTO barbarian_track SET'
				+ ' package_name = :package_name,'
				+ ' package_version = :package_version,'
				+ ' package_username = :package_username,'
				+ ' package_channel = :package_channel,'
				+ ' revision = :revision,'
				+ ' dp = :dp, ua = :ua, uip = :uip',
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
				});
		} finally {
			db_release(connection);
		}
	} catch (e) {
		console.error("[ERROR] track_download failed: " + e);
		return send_error(res, 500, "[ERROR] track_download failed: " + e);
	}
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
app.use(ensure_available)
app.use("/github/v1", epv1);
app.use("/github/v2", epv2);
app.use("/corum", corum_handle_request);

// async function ep_welcome(req: Request, res: Response) {
// 	res.send('Welcome Barbarians!');
// }
// app.get('*', ep_welcome);
app.use(express.static(__dirname + '/static'));

const server = app.listen(5000, '0.0.0.0', () => {
	const { address, family, port } = server.address() as AddressInfo;
	console.log('Server listening on:', 'http://' + address + ':' + port, 'family is', family);
});

