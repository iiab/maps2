#!/usr/bin/bash

# Get the latest static_search.js if we don't have it yet
(ls static_search.js > /dev/null) || wget https://raw.githubusercontent.com/iiab/iiab/refs/heads/master/roles/maps/files/static_search.js

node index.js
