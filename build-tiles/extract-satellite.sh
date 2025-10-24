#!/bin/bash
set -euox pipefail
here="$(dirname "$(readlink -f "$0")")"
cd "$here"

ORIGINAL_SRC=https://maps.black/s2maps-sentinel2-2023.pmtiles
EXTRACTED_DEST=s3://iiab-maps/0/s2maps-sentinel2-2023-zoom_0-12.pmtiles
MAXZOOM=12

# To test thing script on smaller files, uncomment these lines:
#
# ORIGINAL_SRC=https://iiab-maps.danielkrol.com/0/s2maps-sentinel2-2023-zoom_0-07.pmtiles
# EXTRACTED_DEST=s3://iiab-maps/0/s2maps-sentinel2-2023-zoom_0-06.pmtiles
# MAXZOOM=6

# Fail early if these are undefined
TEST="${S3_ACCESS_KEY}"
TEST="${S3_SECRET_KEY}"

# Fail early if s3cmd and wget are not installed
s3cmd --help > /dev/null
wget --help > /dev/null

# Get the cli app
if [ ! -f ./pmtiles ]; then
    wget https://github.com/protomaps/go-pmtiles/releases/download/v1.28.1/go-pmtiles_1.28.1_Linux_x86_64.tar.gz
    tar xzf go-pmtiles_1.28.1_Linux_x86_64.tar.gz
fi

# Get the original pmtiles file
if [ ! -f original.pmtiles ]; then
    wget $ORIGINAL_SRC -O original.tmp

    # only on success, so we don't download it again
    mv original.tmp original.pmtiles
fi

# Extract the smaller pmtiles file from the original
if [ ! -f extracted.pmtiles ]; then
    # Extract the smaller file
    ./pmtiles extract original.pmtiles extracted.tmp --maxzoom=$MAXZOOM

    # only on success, so we don't extract it again
    mv extracted.tmp extracted.pmtiles
fi

# Make an s3 config (note that it saves to the current directory)
cat > ./s3cfg <<EOL
[default]
access_key = ${S3_ACCESS_KEY}
secret_key = ${S3_SECRET_KEY}
bucket_location = auto
host_base = c0f1dc06a53c81e223a54ac913377671.r2.cloudflarestorage.com
host_bucket = c0f1dc06a53c81e223a54ac913377671.r2.cloudflarestorage.com
enable_multipart = True
EOL

# Upload the extracted pmtiles back to S3 (`s3cmd` is available in the Debian repo)
s3cmd put extracted.pmtiles $EXTRACTED_DEST  --config=./s3cfg
