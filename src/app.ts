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

// Conan Server V1..

var epv1 = express.Router();

/*
	Not implemented end points.
*/
async function epv1_noop(req: Request, res: Response) {
	send_json(res, {});
}
epv1.get('/conans/search', epv1_noop);
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
	if (recipe_data_url != null)
		res.redirect(recipe_data_url + "/snapshot.json");
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
	var recipe_data_url = await fetch_github_recipe_data_url_latest(req, res);
	if (recipe_data_url != null)
		send_json(res, {
			"conan_export.tgz": recipe_data_url + "/files/conan_export.tgz",
			"conanmanifest.txt": recipe_data_url + "/files/conanmanifest.txt",
			"conanfile.py": recipe_data_url + "/files/conanfile.py"
		});
	else
		send_404(res);
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

// Conan Server V2..

var epv2 = express.Router();

/*
	Information on the latest recipe revision.

	https://center.conan.io/v2/conans/lyra/1.5.1/_/_/latest
	{
	"revision" : "4fb6e3981f4b64ebe13aa667d4fc1284",
	"time" : "2020-10-20T03:02:46.710+0000"
	}
*/
async function epv2_latest(req: Request, res: Response) {
	var recipe_data_url = get_github_recipe_data_url(req);
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
	var recipe_data_url = get_github_recipe_data_url(req);
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
	var recipe_data_url = get_github_recipe_data_url(req);
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

// Utility..

function get_github_recipe_base_url(req: Request) {
	return "https://raw.githubusercontent.com/"
		+ req.params.package_username + "/" + req.params.package_channel
		+ "/main/.barbarian/"
		+ req.params.package_name + "/" + req.params.package_version;
}

function get_github_recipe_data_url(req: Request) {
	return get_github_recipe_base_url(req);
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

async function fetch_json_self(req: Request, path: string) {
	return fetch_json(req.protocol + '://' + req.hostname + path);
}

async function fetch_github_recipe_data_url_latest(req: Request, res: Response) {
	var recipe_data_url = get_github_recipe_data_url(req);
	var latest = await fetch_json(recipe_data_url + "/latest.json");
	if (latest != null) {
		return recipe_data_url + "/" + latest["revision"];
	}
	else {
		send_404(res);
		return null;
	}
}

// Server..

function log(req: Request, res: Response, next: any) {
	console.log("[INFO] url = " + req.url + " params = " + JSON.stringify(req.params));
	next();
}

function capabilities(req: Request, res: Response, next: any) {
	res.setHeader("X-Conan-Server-Capabilities", "revisions");
	// res.setHeader("X-Conan-Server-Capabilities", "");
	next();
}

const app = express();
app.use(ExpressGA('UA-15160295-7'));
app.use(express.json());
app.use(log);
app.use(capabilities);
app.use("/github/v1", epv1);
app.use("/github/v2", epv2);

// async function ep_welcome(req: Request, res: Response) {
// 	res.send('Welcome Barbarians!');
// }
// app.get('*', ep_welcome);
app.use(express.static(__dirname));

const server = app.listen(5000, '0.0.0.0', () => {
	const { port, address } = server.address() as AddressInfo;
	console.log('Server listening on:', 'http://' + address + ':' + port);
}
);
