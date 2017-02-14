#!/bin/bash

if [[ -z "$1" ]]; then
	SCRIPT="fortune-top-100.sh"
else
	# e.g., ./run-experiments.sh motivating-examples.sh
	SCRIPT="$1"
fi

# Build
./initracer.js --mode build

# Run 'observation' mode
./$SCRIPT --no-build --replay --upload replay --mode observation --skip --no-screenshot

# Run 'validation' and 'post-validation' mode
./$SCRIPT --no-build --replay --upload replay --mode adverse --validate --skip --no-screenshot

# Re-run 'validation' and 'post-validation' mode in case some failed...
# (--skip ensures that already completed jobs are not repeated)
./$SCRIPT --no-build --replay --upload replay --mode adverse --validate --skip --no-screenshot

# Take screenshots
./$SCRIPT --no-build --replay --upload replay --mode screenshot --screenshot
