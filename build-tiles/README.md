Create level 12 zoom of satellite pmtiles file (https://maps.black/s2maps-sentinel2-2023.pmtiles) and upload it to a hardcoded S3 bucket and directory.

# To run

* Make sure `wget` and `s3cmd` are installed.
* Define the `S3_ACCESS_KEY` and `S3_SECRET_KEY` for the bucket.
* Run `extract-satellite.sh`, ideally in a separate directory.
    * NOTE: It will download and execute the `pmtiles` cli app from Github.

Note that this rarely ever needs to happen, since apparently the data doesn't come out that often (at least, as of 2025 maps.black has only produced 2016 and 2023).

# TODO:

* Create variations for all other zoom levels we want. (7 and 11 probably)
* Upload to wherever the final destination for such things belong, instead of this temporary S3.
* Also just download and upload the original 13 zoom level variety, unless we want to keep downloading from maps.black forever.
