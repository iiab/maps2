# Get expected tile sizes for 1km sq or 1000km sq. We can edit this to easily get other sorts of data.
#
# Put this file in /opt/iiab/maps/tile-extract/
#
# To run:
# $ cd /opt/iiab/maps/tile-extract/
# $ sudo python3
# >>> import stats
# >>> s, av, ag = aoeu.sample_sizes("urban")
# or:
# >>> s, av, ag = aoeu.sample_sizes("general")
#
# It'll give you a useful output, and you can poke at the data in the returned values.

import importlib  
foobar = importlib.import_module("tile-extract")

def sample_sizes(super_region_type):
    EARTH_CIRCUMFERENCE = 40_000

    # given a starting latitude, how much latitude difference does a given number of km make?
    def km_to_lat_diff(num_km):
        return num_km * 360 / EARTH_CIRCUMFERENCE

    # given a starting latitude, how much longitude difference does a given number of km make?
    def km_to_lng_diff(num_km, from_lat):
        lng_diff_at_equator = num_km * 360 / EARTH_CIRCUMFERENCE
        lat_factor = math.cos(math.radians(from_lat))
        return lng_diff_at_equator / lat_factor

    super_regions = {
        "general": {
            "africa_1": [-10.015664717, 8.830356531, 30.182103077, 28.023407063],
            "africa_2": [16.948270058, -25.634324545, 32.994292594, 2.909047373],

            "south_america_1": [-72.498008803, -14.23300222, -51.489298885, 0.837192573],
            "south_america_2": [-69.851242199, -36.851482008, -57.940792482, -22.696535966],

            "north_america_1": [-118.935291346, 36.405237917, -78.241254814, 48.981154605],
            "north_america_2": [-122.905441252, 49.19781828, -95.776083563, 64.986217661],
            "north_america_3": [-144.244996995, 61.172707143, -97.099466865, 67.132863963],

            "eurasia_1": [59.03095955, 61.769367297, 156.961323889, 67.36013931],
            "eurasia_2": [32.894139338, 49.257484142, 133.802116106, 63.369260152],
            "eurasia_3": [58.038422074, 27.809514426, 118.086939397, 45.796549794],
        },
        "urban": {
            "nyc1": [-74.301691987, 40.628274259, -73.876704832, 40.997735658],
            "nyc2": [-73.830760275, 40.678380532, -73.276554052, 40.800221031],
            "dc": [-77.333527438, 38.71886972, -76.728851314, 39.100331833],
            "chicago": [-88.138404262, 41.634129248, -87.674509935, 42.020469682],
            "mexico_city": [-99.262378568, 19.32618945, -98.945675027, 19.579738368],
            "new_delhi": [77.060962979, 28.500181587, 77.363423183, 28.681960219],
            "karachi": [67.016216846, 24.814269885, 67.155142453, 24.922833071],
            "belgaluru": [77.515411447, 12.933111371, 77.654005256, 13.020179371],
            "taipei": [121.511056798, 25.022323823, 121.572400136, 25.069405779],
            "lima": [-77.06314977, -12.110469575, -76.975083913, -12.049809453],
            "nairobi": [36.785323794, -1.32113556, 36.851044895, -1.266997758],
            "moscow": [37.480708389, 55.652002375, 37.795991515, 55.803340764],
            "sydney_aus": [150.984846855, -33.95959301, 151.262251641, -33.85530602],
            "jakarta": [106.679648433, -6.321778849, 107.031210933, -6.13406584],
        },
    }[super_region_type]

    all_sizes = { # in km
        "general": [1, 1000],
        "urban": [1], # urban areas don't have megameter super-regions
    }[super_region_type]

    attemtps_to_make = { # in km
        "general": 100,
        "urban": 25, # there just aren't that many 1x1 areas in a city
    }[super_region_type]

    assert "average" not in super_regions

    samples = {}
    for size in all_sizes:
        samples[size] = defaultdict(list)
        for sr_name, sr_coordinates in super_regions.items():
            sr_min_lng, sr_min_lat, sr_max_lng, sr_max_lat = sr_coordinates
            for attempt in range(attemtps_to_make):
                # random.uniform is a funny name for a function but it gets a
                # random float in the given range (presumably with uniform distribution)

                sample_height = km_to_lat_diff(size)
                sample_min_lat = random.uniform(sr_min_lat, sr_max_lat - sample_height)
                sample_max_lat = sample_min_lat + sample_height
                sample_mid_lat = (sample_min_lat + sample_max_lat) / 2

                # using sample_mid_lat is an estimate. to be proper we'd need
                # the average across an integral but this has to be good enough.
                sample_width = km_to_lng_diff(size, sample_mid_lat)
                sample_min_lng = random.uniform(sr_min_lng, sr_max_lng - sample_width)
                sample_max_lng = sample_min_lng + sample_width

                new_estimates = get_estimates(','.join(map(str, [
                    sample_min_lng, sample_min_lat, sample_max_lng, sample_max_lat
                ])))

                # give it more useful keys
                samples[size][sr_name].append({
                    "vector":    new_estimates['https://iiab.switnet.org/maps/2/openstreetmap-openmaptiles.2026-04-01.z00-z14.pmtiles'],
                    "satellite": new_estimates['https://iiab.switnet.org/maps/2/s2maps-sentinel2-2023.2025-12-10.z00-z13.pmtiles'],
                    "terrain":   new_estimates['https://iiab.switnet.org/maps/2/terrarium.2025-12-10.z00-z10.pmtiles'],
                })

    averages = {}
    for size in samples:
        averages[size] = {}
        for sr in samples[size]:
            averages[size][sr] = {}
            for attempt_data in samples[size][sr]:
                attempt_data['total'] = {
                    "transfer": sum(attempt_data[tiles_type]["transfer"] for tiles_type in attempt_data),
                    "archive": sum(attempt_data[tiles_type]["archive"] for tiles_type in attempt_data),
                }
            for tiles_type in ['vector', 'satellite', 'terrain', 'total']:
                averages[size][sr][tiles_type] = {'transfer': {}, 'archive': {}}
                for size_type in ['transfer', 'archive']:
                    averages[size][sr][tiles_type][size_type] = sum([
                        attempt_data[tiles_type][size_type] for attempt_data in samples[size][sr]
                    ]) / len(samples[size][sr])

        averages[size]["average"] = {}
        for tiles_type in ['vector', 'satellite', 'terrain', 'total']:
            averages[size]["average"][tiles_type] = {'transfer': {}, 'archive': {}}
            for size_type in ['transfer', 'archive']:
                averages[size]["average"][tiles_type][size_type] = sum([
                    averages[size][sr][tiles_type][size_type] for sr in super_regions
                ]) / (len(super_regions) * 1_000_000.0)

    aggregates = {}
    for size in samples:
        aggregates[size] = {}
        for sr in samples[size]:
            aggregates[size][sr] = {}
            for tiles_type in ['vector', 'satellite', 'terrain', 'total']:
                aggregates[size][sr][tiles_type] = {'transfer': {}, 'archive': {}}
                for size_type in ['transfer', 'archive']:
                    aggregates[size][sr][tiles_type][size_type] = [
                        attempt_data[tiles_type][size_type] / 1_000_000.0
                        for attempt_data in samples[size][sr]
                    ]

   # Display something useful
    for size in all_sizes:
        print (size, 'km sq:')
        for tiles_type in ['vector', 'satellite', 'terrain']:
            print (' ', tiles_type, ':')
            print ("    average")
            for size_type in ['transfer', 'archive']:
                print ('     ', size_type, ":", averages[size]['average'][tiles_type][size_type])
            print ("    max")
            for size_type in ['transfer', 'archive']:
                print ('     ', size_type, ":", max([max(aggregates[size][sr][tiles_type][size_type]) for sr in aggregates[size]]))

    # return it in case we want to play with it more
    return samples, averages, aggregates
