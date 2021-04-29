#!/bin/bash

# Copyright 2021 René Ferdinand Rivera Morell
# Distributed under the Boost Software License, Version 1.0.
# (See accompanying file LICENSE.txt or copy at
# http://www.boost.org/LICENSE_1_0.txt)

npm run build
scp dist/app.js bfgbarbarian@barbarian.bfgroup.xyz:/home/bfgbarbarian/barbarian.bfgroup.xyz/app.js
scp package.json bfgbarbarian@barbarian.bfgroup.xyz:/home/bfgbarbarian/barbarian.bfgroup.xyz/package.json
ssh bfgbarbarian@barbarian.bfgroup.xyz "cd /home/bfgbarbarian/barbarian.bfgroup.xyz && npm install"
