#!/bin/bash

# Copyright 2021 René Ferdinand Rivera Morell
# Distributed under the Boost Software License, Version 1.0.
# (See accompanying file LICENSE.txt or copy at
# http://www.boost.org/LICENSE_1_0.txt)

NAME=${1}.bfgroup.xyz

echo DEPLOYING ${NAME} ...

# Clean build the site.
rm -rf ${NAME}
if test ${NAME} = "barbarian.bfgroup.xyz" ; then
	b2 variant=release
elif test ${NAME} = "jenna.bfgroup.xyz" ; then
	b2 variant=debug
else
	exit 1
fi

# Deploy the built "dist" tree.
rsync -v -c -r --delete -h ${NAME} bfgbarbarian@${NAME}:/home/bfgbarbarian/
rsync -v -c -r --delete -h src/website/.htaccess package.json bfgbarbarian@${NAME}:/home/bfgbarbarian/${NAME}/

# Deploy the out-of-root auth creds for the database.
scp .dbconf*.js bfgbarbarian@${NAME}:/home/bfgbarbarian

# Update the node modules and reboot the server to match.
ssh bfgbarbarian@${NAME} "cd /home/bfgbarbarian/${NAME} && npm install && mkdir -p tmp && touch tmp/restart.txt"
