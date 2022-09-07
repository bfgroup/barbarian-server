#!/bin/bash

# Copyright 2021-2022 René Ferdinand Rivera Morell
# Distributed under the Boost Software License, Version 1.0.
# (See accompanying file LICENSE.txt or copy at
# http://www.boost.org/LICENSE_1_0.txt)

ROOT=${1}
NAME=${2}.bfgroup.xyz

echo DEPLOYING ${NAME} ...

pushd ${ROOT}

# Clean any leftover remote files.
ssh bfgbarbarian@${NAME} "rm -rf /home/bfgbarbarian/deploy/${NAME}"

# Deploy the built "dist" tree.
rsync -v -c -r --del -h ${NAME} bfgbarbarian@${NAME}:/home/bfgbarbarian/deploy/

# Deploy the out-of-root auth creds for the database.
scp .dbconf*.js src/website/deploy_remote.sh bfgbarbarian@${NAME}:/home/bfgbarbarian

# Update the node modules and reboot the server to match.
ssh bfgbarbarian@${NAME} "/home/bfgbarbarian/deploy_remote.sh ${NAME}"

popd
