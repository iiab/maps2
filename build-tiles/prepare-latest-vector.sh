#!/usr/bin/bash

set -euo pipefail

# Fail early if wget is not installed
(wget --help > /dev/null 2> /dev/null) || (echo "Error: this requires wget"; exit 1)

# Get the cli app
if [ ! -f ./pmtiles ]; then
    echo "This will download and use the pmtiles CLI tool from github. Hit ctrl-c to cancel. Hit enter to continue."
    read

    wget https://github.com/protomaps/go-pmtiles/releases/download/v1.28.1/go-pmtiles_1.28.1_Linux_x86_64.tar.gz
    tar xzf go-pmtiles_1.28.1_Linux_x86_64.tar.gz
    echo
    echo
    echo
fi

BASE=openstreetmap-openmaptiles
if [ $# -gt 0 ] && [ $1 == "test" ]; then
    BASE=naturalearth6-NE2_HR_SR_W_DR-WEBP
fi

SOURCE=https://maps.black/$BASE.pmtiles
OSM_Z14=openstreetmap-openmaptiles.$DATA_DATE.z00-z14.pmtiles
OSM_Z9=openstreetmap-openmaptiles.$DATA_DATE.z00-z09.pmtiles
OSM_Z1=openstreetmap-openmaptiles.$DATA_DATE.z00-z01.pmtiles

echo "The latest $SOURCE is from..."
echo

DATA_DATE=$(
  curl -Is $SOURCE |
  grep last-modified |
  cut -c 16- |
  python3 -c "import sys, dateparser; dt = dateparser.parse(sys.stdin.read()); print(dt.date())"
)
echo $DATA_DATE

echo
echo "These are expected to be released once a month. If this is close to a month old, perhaps wait"
echo "for the next one? We wouldn't want it to change over mid-download!"
echo
echo "To not use this version, hit ctrl-c. Otherwise hit enter to continue."
read

# Get the original pmtiles file
if [ ! -f $OSM_Z14 ]; then
    wget $SOURCE -O $OSM_Z14.tmp

    # only on success, so we don't download it again
    mv $OSM_Z14.tmp $OSM_Z14
fi

# Extract the zoom-9 pmtiles file from the original
if [ ! -f $OSM_Z9 ]; then
    # Extract the smaller file
    ./pmtiles extract $OSM_Z14 $OSM_Z9.tmp --maxzoom=9

    # only on success, so we don't extract it again
    mv $OSM_Z9.tmp $OSM_Z9
fi

# Extract the zoom-1 pmtiles file from the original
if [ ! -f $OSM_Z1 ]; then
    # Extract the smaller file
    ./pmtiles extract $OSM_Z14 $OSM_Z1.tmp --maxzoom=1

    # only on success, so we don't extract it again
    mv $OSM_Z1.tmp $OSM_Z1
fi
