Build a search database for Nominatim.

To Run:

* Make sure you're on a system that you don't mind "screwing up". This will use `sudo` to install stuff and change settings! I did not optimize for being "careful".
* If you're running "for real", make sure you're on a system that has "a lot" of memory and disk space.
* If you're running just to develop this script further and you don't have "a lot" of memory and disk space:
    * Set `DEV=1` in the environment.
    * Go into nominatim-setup.sh.prep and (in multiple places) comment out planet.osm.pbf and comment in one of the smaller pbf files to try out.
* Run `./install-and-build.sh`.

# TODO

* Upload it to S3, or wherever the final destination for such things belong.
* Allow choosing pbf file in nominatim-setup.sh via env var.
* Specify what "a lot" of memory and disk space is above.
