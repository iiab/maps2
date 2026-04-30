#!/usr/bin/python3
import string, sys, json, os, filecmp

if not os.path.exists('maps.black'):
    sys.exit("Please make sure that maps.black repo is checked out in this directory")

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
    print ( "} else {")
    print ( "    console.log(UNEXPECTED_ID_ERROR)")
    print ( "}")

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

def compare_style_dirs(dir_1, dir_2):
    dcmp = filecmp.dircmp(dir_1, dir_2)

    def recursive_diffs(dcmp, path=None):
        path = path or []
        files = (
            [path + [file] for file in dcmp.diff_files] +
            [path + [file] for file in dcmp.left_only] +
            [path + [file] for file in dcmp.right_only]
        )

        for subdir, sub_dcmp in dcmp.subdirs.items():
            files += recursive_diffs(sub_dcmp, path + [subdir])

        return files

    diffs = recursive_diffs(dcmp)
    assert diffs == [['style.json']], diffs

def compare_styles(osm_path, nat_path):
    file_a = json.loads(open(os.path.join(osm_path, "style.json")).read())
    file_b = json.loads(open(os.path.join(nat_path, "style.json")).read())

    # Don't worry about this part
    del file_b['sources']['naturalearth-openmaptiles']
    del file_a['sources']['openstreetmap-openmaptiles']

    # Delete the sprite links but assert that the sprites dir (and everything else other than style.json) is identical
    assert ('sprite' in file_a) == ('sprite' in file_b)
    if 'sprite' in file_a:
        del file_b['sprite']
        del file_a['sprite']
    compare_style_dirs(osm_path, nat_path)

    print ("UNEXPECTED_ID_ERROR = 'FILL ME IN'")
    print ()
    parse_structs(file_a, file_b, None, None, [])

print ("// for openfreemap/liberty")
print ()

compare_styles(
    "maps.black/styles/openstreetmap-openmaptiles/openfreemap/liberty",
    "maps.black/styles/naturalearth-openmaptiles/openfreemap/liberty",
)
print ()
print ()
print ()

print ("// for maps.black/hybrid-2023")
print ()

compare_styles(
    "maps.black/styles/openstreetmap-openmaptiles/maps.black/hybrid-2023",
    "maps.black/styles/naturalearth-openmaptiles/maps.black/hybrid-2023",
)
