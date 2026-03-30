#!/usr/bin/bash
set -euo pipefail

# Since static_search.js is a symlink, we need a package.json next to the real file so it's not considered a CommonJS.
# node follows symlinks like that for whatever reason.
(ls ~/iiab/roles/maps/files/package.json > /dev/null 2> /dev/null) || cp -i package.json ~/iiab/roles/maps/files/

# On the crazy off-chance there was already a package.json file there, and the contents were different than what we want, let us know.
diff package.json ~/iiab/roles/maps/files/package.json || (echo "Unexpected package.json"; exit 1)

node index.js
