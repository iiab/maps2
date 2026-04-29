I think there's a decent shot we can cut the size of our vector tiles in half. Just by experimentation it looked like vtshaver cut individual tiles by about that much. I tried 0/0/0 and also something close to street level in New York City. However, important: I did not get as far as rebuilding the tileset and actually looking at the result.

Here are the tools I used to get as far as I did.

---

tile-join - `sudo apt install tippecanoe`
* pmtiles -> mbtiles (among other things!)

mbutil - https://github.com/mapbox/mbutil
* Convert mbtiles to a directory structure
* Convert a directory structure to mbtiles?

go-pmtiles
* Could extract files tile-by-tile instead of mbutil
* Still need mbutil to put everything back together(?)
* pmtiles convert: mbtiles with shrunken tiles -> pmtile
* inspect things? It could come in handy.

vtshaver - https://github.com/mapbox/vtshaver
* Only runs on a single tile. multishave.py needs to handle the whole tileset.
  * original-tiles -> shrunken-tiles (one by one)
* Can we put in multiple styles? Maybe we can edit it to do so.
* Otherwise we need to concatenate the styles we'll be using.
  * liberty.json + political.json + hybrid.json
* Maybe we can make smaller ones if we want to make tiny versions?
  * liberty-small.json

---

And here's how I imagine the process, including something close to the commands I ran:

---

multishave.py - combine it all
* Commands:
  * [combine style jsons into one combined.json]
  * tile-join --no-tile-size-limit -o tiles.mbtiles tiles.pmtiles
  * python3 mb-util ../tiles.mbtiles ../original-tiles
  * [gunzip all the tiles in ../original-tiles]
  * for cur_tile in tiles: (pseudocode)
    * ./vtshaver/bin/vtshave.js --tile original_tile/[cur_tile] --style [combined.json] --out shrunken-tiles/[cur_tile] --zoom 0 --maxzoom 14
  * [gzip all the tiles in ../shrunken-tiles]
  * python3 mb-util ../shrunken-tiles ../tiles.mbtiles (does this work?)
  * pmtiles convert shrunken.mbtiles shrunken.pmtiles
