#!/usr/bin/python3
import string, sys, json, os

if not os.path.exists('maps.black'):
    sys.exit("Please make sure that maps.black repo is checked out in this directory")

file_a = json.loads(open("maps.black/styles/openstreetmap-openmaptiles/openfreemap/liberty/style.json").read())
file_b = json.loads(open("maps.black/styles/naturalearth-openmaptiles/openfreemap/liberty/style.json").read())

def index_syntax(key):
    if isinstance(key, str):
        if set(string.ascii_letters) >= set(key):
            return f".{key}"
        else:
            return f"['{key}']"
    else:
        return f"[{key}]"

def print_correction(val_a, val_b, obj_a, obj_b, trail):
    if trail[-1] == 'source' and val_b == 'naturalearth-openmaptiles':
        return

    # Just gonna go ahead and assume that this is a maxzoom on the same id'd layer
    assert trail[-1] in ['maxzoom', 'minzoom'], trail[-1]
    assert obj_a['id'] == obj_b['id']

    parent_obj_path = ''.join(index_syntax(key) for key in trail[:-1])
    obj_path = ''.join(index_syntax(key) for key in trail)

    print (f"if (styles{parent_obj_path}.id === '{obj_b['id']}') {{")
    print (f"    styles{obj_path} = {val_b} # from {val_a}")
    print (f"}} else {{")
    print (f"    console.log(UNEXPECTED_ID_ERROR)")
    print (f"}}")

def parse_structs(obj_a, obj_b, parent_a, parent_b, trail):
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
            print_correction(obj_a, obj_b, parent_a, parent_b, trail)
        return

    for key, val_a in iterable:
        val_b = obj_b[key]
        new_trail = trail + [key]
        parse_structs(val_a, val_b, obj_a, obj_b, new_trail)

# Don't worry about this part
del file_b['sources']['naturalearth-openmaptiles']
del file_a['sources']['openstreetmap-openmaptiles']

# TODO - assert that the sprite files are identical

del file_b['sprite']
del file_a['sprite']

print ("UNEXPECTED_ID_ERROR = 'FILL ME IN'")
print ()
parse_structs(file_a, file_b, None, None, [])
