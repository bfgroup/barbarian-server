/*
Copyright 2021 René Ferdinand Rivera Morell
Distributed under the Boost Software License, Version 1.0.
(See accompanying file LICENSE.txt or copy at
http://www.boost.org/LICENSE_1_0.txt)
*/

import express from "express";
import { Request, Response } from "express";
import { AddressInfo } from "net"

// Conan Server V1..

var epv1 = express.Router();

function epv1_ping(req: Request, res: Response) {
	console.log("[INFO] epv1_ping: params = " + JSON.stringify(req.params));
	send_json(res, {
		"hello": "Welcome Barbarians!",
		"version": process.env.npm_package_version
	});
}
epv1.get('/ping', epv1_ping);

function epv1_noop(req: Request, res: Response) {
	send_json(res, {});
}
epv1.get('/conans/search', epv1_noop);
epv1.get('/conans/*/search', epv1_noop);
epv1.get('/conans/*/upload_urls', epv1_noop);

/*
Returns the snapshot of the recipe files for the specified Conan recipe. The snapshot is a list of filenames with their associated md5 hash.

https://center.conan.io/v1/conans/lyra/1.5.1/_/_
{
  "conan_export.tgz" : "feee725dad53a465ab74eda1bfe98e81",
  "conanmanifest.txt" : "a9bac22e1071021a30b78142a4b4843c",
  "conanfile.py" : "c8d339a433f888a6217afcaeb744b36a"
}
*/
function epv1_snapshot(req: Request, res: Response) {
	console.log("[INFO] epv1_snapshot: params = " + JSON.stringify(req.params));
	var recipe_data_url = get_github_recipe_data_url(req);
	res.redirect(recipe_data_url + "/snapshot.json")
}
epv1.get('/conans/:package_name/:package_version/:package_username/:package_channel', epv1_snapshot);

/*
List of recipe filenames with their associated download URLs. 

https://center.conan.io/v1/conans/lyra/1.5.1/_/_/digest
{
  "conanmanifest.txt" : "https://center.conan.io/artifactory/api/conan/conan-center/v1/files/_/lyra/1.5.1/_/4fb6e3981f4b64ebe13aa667d4fc1284/export/conanmanifest.txt"
}
*/
function epv1_digest(req: Request, res: Response) {
	console.log("[INFO] epv1_digest: params = " + JSON.stringify(req.params));
	var recipe_data_url = get_github_recipe_data_url(req);
	send_json(res, {
		"conanmanifest.txt": recipe_data_url + "/export/conanmanifest.txt"
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
function epv1_download_urls(req: Request, res: Response) {
	console.log("[INFO] epv1_download_urls: params = " + JSON.stringify(req.params));
	var recipe_data_url = get_github_recipe_data_url(req);
	send_json(res, {
		"conan_export.tgz": recipe_data_url + "/conan_export.tgz",
		"conanmanifest.txt": recipe_data_url + "/export/conanmanifest.txt",
		"conanfile.py": recipe_data_url + "/export/conanfile.py"
	});
}
epv1.get('/conans/:package_name/:package_version/:package_username/:package_channel/download_urls', epv1_download_urls);

/*
Fallback.
*/
function epv1_hello(req: Request, res: Response) {
	console.log("[INFO] epv1_welcome: url = " + req.url);
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

/*
Fallback.
*/
function epv2_hello(req: Request, res: Response) {
	console.log("[INFO] epv2_welcome: url = " + req.url);
	send_json(res, {
		"hello": "Welcome Level 2 Barbarians!",
		"version": process.env.npm_package_version
	});
}
epv1.get('*', epv2_hello);

// Conan Server Root..

const app = express();
app.use(express.json());
app.use("/github/v1", epv1);
app.use("/github/v2", epv2);

// function ep_welcome(req: Request, res: Response) {
// 	console.log("[INFO] ep_welcome: url = " + req.url);
// 	res.send('Welcome Barbarians!');
// }
// app.get('*', ep_welcome);
app.use(express.static(__dirname));

// Utility..

function get_github_recipe_base_url(req: Request) {
	return "https://raw.githubusercontent.com/"
		+ req.params.package_username + "/" + req.params.package_channel
		+ "/main/.conan/data/"
		+ req.params.package_name + "/" + req.params.package_version;
}

function get_github_recipe_data_url(req: Request) {
	return get_github_recipe_base_url(req) + "/_/_";
}

function send_json(res: Response, data: object) {
	// res.setHeader("X-Conan-Server-Capabilities", "revisions");
	res.setHeader("X-Conan-Server-Capabilities", "");
	res.setHeader("Content-Type", "application/json");
	res.status(200).send(Buffer.from(JSON.stringify(data)));
}

const server = app.listen(5000, '0.0.0.0', () => {
	const { port, address } = server.address() as AddressInfo;
	console.log('Server listening on:', 'http://' + address + ':' + port);
}
);
