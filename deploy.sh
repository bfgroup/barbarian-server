#!/bin/bash

# Copyright 2021 René Ferdinand Rivera Morell
# Distributed under the Boost Software License, Version 1.0.
# (See accompanying file LICENSE.txt or copy at
# http://www.boost.org/LICENSE_1_0.txt)

# Clean build the site.
npm run build
b2 src/website/static//html

# Deploy the built "dist" tree.
rsync -v -c -r --delete -h barbarian.bfgroup.xyz bfgbarbarian@barbarian.bfgroup.xyz:/home/bfgbarbarian/
rsync -v -c -r --delete -h src/website/.htaccess package.json bfgbarbarian@barbarian.bfgroup.xyz:/home/bfgbarbarian/barbarian.bfgroup.xyz/

# Deploy the out-of-root auth creds for the database.
scp .dbconf*.js bfgbarbarian@barbarian.bfgroup.xyz:/home/bfgbarbarian

# Update the node modules and reboot the server to match.
ssh bfgbarbarian@barbarian.bfgroup.xyz "cd /home/bfgbarbarian/barbarian.bfgroup.xyz && npm install && mkdir -p tmp && touch tmp/restart.txt"
