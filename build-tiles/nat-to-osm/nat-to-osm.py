import string, sys, json, requests

# TODO - download the files from the git repo instead of getting them from file
# https://raw.githubusercontent.com/maps-black/maps.black/refs/heads/main/styles/naturalearth-openmaptiles/openfreemap/liberty/style.json
# https://raw.githubusercontent.com/maps-black/maps.black/refs/heads/main/styles/openstreetmap-openmaptiles/openfreemap/liberty/style.json

file_a = json.loads(open(sys.argv[1]).read())
file_b = json.loads(open(sys.argv[2]).read())

def index_syntax(key):
    if isinstance(key, str):
        if set(string.ascii_letters) >= set(key):
            return f".{key}"
        else:
            return f"['{key}']"
    else:
        return f"[{key}]"

def print_correction(val_a, val_b, trail):
    if trail[-1] == 'source' and val_b == 'naturalearth-openmaptiles':
        return

    print (
        'style' + ''.join(
            index_syntax(key) for key in trail
        ) + " = " + str(val_b) +
        f" # from {val_a}"
    )

def parse_structs(obj_a, obj_b, trail):
    # print(trail)
    if isinstance(obj_a, dict):
        assert obj_a.keys() == obj_b.keys(), f"{trail} {obj_a.keys()} != {obj_b.keys()}"
        iterable = obj_a.items()
    elif isinstance(obj_a, list):
        assert len(obj_a) == len(obj_b), f"{trail} {len(obj_a)} != {len(obj_b)}"
        iterable = enumerate(obj_a)
    else:
        # print (obj_a, obj_b)
        if obj_a != obj_b:
            print_correction(obj_a, obj_b, trail)
        return

    for key, val_a in iterable:
        val_b = obj_b[key]
        new_trail = trail + [key]
        parse_structs(val_a, val_b, new_trail)

# Don't worry about this part
del file_b['sources']['naturalearth-openmaptiles']
del file_a['sources']['openstreetmap-openmaptiles']

# TODO - assert that the sprite files are identical

del file_b['sprite']
del file_a['sprite']

parse_structs(file_a, file_b, [])
