/*
Copyright 2021 René Ferdinand Rivera Morell
Distributed under the Boost Software License, Version 1.0.
(See accompanying file LICENSE.txt or copy at
http://www.boost.org/LICENSE_1_0.txt)
*/

import { app } from "./app"
import { AddressInfo } from "net"

const server = app.listen(5000, '0.0.0.0', () => {
	const { port, address } = server.address() as AddressInfo;
	console.log('Server listening on:', 'http://' + address + ':' + port);
}
);
