#!/bin/bash

# Copyright 2022 René Ferdinand Rivera Morell
# Distributed under the Boost Software License, Version 1.0.
# (See accompanying file LICENSE.txt or copy at
# http://www.boost.org/LICENSE_1_0.txt)

NAME=${1}

echo INITIALIZING ${NAME} ...

cd /home/bfgbarbarian/deploy/${NAME}
npm install
mkdir -p tmp
touch tmp/restart.txt

echo PUBLISHING ${NAME} ...

cd /home/bfgbarbarian
mv /home/bfgbarbarian/${NAME} /home/bfgbarbarian/deploy/${NAME}.old
mv /home/bfgbarbarian/deploy/${NAME} /home/bfgbarbarian/${NAME}
touch /home/bfgbarbarian/deploy/${NAME}.old/tmp/restart.txt
rm -rf /home/bfgbarbarian/deploy/${NAME}.old
