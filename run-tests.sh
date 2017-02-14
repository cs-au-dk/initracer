#!/bin/bash

# Start http-server
http-server &

# Build
./initracer.js --mode build --skip

# Run 'observation' and 'adverse' mode
./tests.sh --no-build --skip --no-screenshot

# Run 'validation' and 'post-validation' mode
./tests.sh --no-build --mode adverse --validate --skip --no-screenshot

# Re-run 'validation' and 'post-validation' mode in case some failed...
./tests.sh --no-build --mode adverse --validate --skip --no-screenshot

# Take screenshots for debugging
./tests.sh --no-build --mode screenshot --screenshot
