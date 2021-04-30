#!/bin/bash

# Copyright 2021 René Ferdinand Rivera Morell
# Distributed under the Boost Software License, Version 1.0.
# (See accompanying file LICENSE.txt or copy at
# http://www.boost.org/LICENSE_1_0.txt)

npm run build
b2 src//html
scp dist/*.js dist/*.css dist/*.png dist/*.html dist/*.ico package.json bfgbarbarian@barbarian.bfgroup.xyz:/home/bfgbarbarian/barbarian.bfgroup.xyz/
ssh bfgbarbarian@barbarian.bfgroup.xyz "cd /home/bfgbarbarian/barbarian.bfgroup.xyz && npm install && touch tmp/restart.txt"
