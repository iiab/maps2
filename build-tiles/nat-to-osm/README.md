It looks like our best way forward, for the sake of FQRs, is to treat the Natural Earth tileset as if it's an OpenStreetMap tileset. We can use the same "natural" style as openstreetmap, and it actually looks ostensibly fine. However to make sure it's optimized the same way, we tweak the maxzoom and minzoom of various layers to make sure it matches exactly.

So this script will inspect both styles and generate commands to convert from one to the other.

We can also use the political style, though for now we won't tweak it. We don't know upfront what to tweak it to. Perhaps we could study the difference between the "natural" style (actually called "liberty") for osm and natural earth and make the same adjustments to the "political" style. Though maybe don't spend too much time there either because we could make a better political style anyway.
