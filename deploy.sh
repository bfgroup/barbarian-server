#!/bin/bash

# Copyright 2021-2022 René Ferdinand Rivera Morell
# Distributed under the Boost Software License, Version 1.0.
# (See accompanying file LICENSE.txt or copy at
# http://www.boost.org/LICENSE_1_0.txt)

NAME=${1}.bfgroup.xyz

echo BUILDING ${NAME} ...

# We need to calculate and set SCRIPT_PATH and SCRIPT_DIR to reference this
# script so that we can refer to file relative to it.
SCRIPT_PATH=""
if test "${BASH_SOURCE}" ; then
    SCRIPT_PATH=${BASH_SOURCE}
fi
if test "${SCRIPT_PATH}" = "" ; then
    SCRIPT_PATH=$0
fi
SCRIPT_DIR="$( cd "$( dirname "${SCRIPT_PATH}" )" && pwd )"

# This script needs to operate at engine source directory.
pushd "${SCRIPT_DIR}"

# Rebuild the site.
rm -rf ${NAME}
if test ${NAME} = "barbarian.bfgroup.xyz" ; then
	b2 variant=release
elif test ${NAME} = "jenna.bfgroup.xyz" ; then
	b2 variant=debug
else
	exit 1
fi

# Clean any leftover remote files.
ssh bfgbarbarian@${NAME} "rm -rf /home/bfgbarbarian/deploy/${NAME}"

# Deploy the built "dist" tree.
rsync -v -c -r --del -h ${NAME} bfgbarbarian@${NAME}:/home/bfgbarbarian/deploy/

# Deploy the out-of-root auth creds for the database.
scp .dbconf*.js deploy_remote.sh bfgbarbarian@${NAME}:/home/bfgbarbarian

# Update the node modules and reboot the server to match.
ssh bfgbarbarian@${NAME} "/home/bfgbarbarian/deploy_remote.sh ${NAME}"

echo VERIFYING ${NAME} ...

# VVerify it's actually running by doing a Conan api ping.
curl "https://${NAME}/github/v1/ping"
echo

popd
