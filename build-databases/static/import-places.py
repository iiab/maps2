import csv, gzip, regex, requests, json, os, tarfile, unicodedata, zipfile
from io import BytesIO, StringIO, TextIOWrapper
from collections import defaultdict, namedtuple
from datetime import date

# `city_identifier` uniquely identifies a city
city_identifier = namedtuple("city_identifier", ["name", "admin1", "country"])

# Turn geojsons and geonames city csv into our trimmed down csv format for later search import
# Note that geonames is not OSM data. This may be an alternative if we ever care: https://wiki.openstreetmap.org/wiki/OSMNames

# Make the normal csv reader act more like a dict reader using column names defined
# on their info page. See: https://download.geonames.org/export/dump/
# Just a personal preference
class Row():
    def __repr__(self):
        return repr(dict(zip(self.column_names, self.row)))

    def __init__(self, row):
        self.row = row

    def __getitem__(self, field):
        if field not in self.column_names:
            raise Exception("Invalid field name")
        return self.row[self.column_names.index(field)]

    def __setitem__(self, field, val):
        if field not in self.column_names:
            raise Exception("Invalid field name")
        self.row[self.column_names.index(field)] = val

class CitiesRow(Row):
    column_names = [
        "geonameid",
        "name",
        "asciiname",
        "alternatenames",
        "latitude",
        "longitude",
        "feature_class",
        "feature_code",
        "country_code",
        "cc2",
        "admin1_code",
        "admin2_code",
        "admin3_code",
        "admin4_code",
        "population",
        "elevation",
        "dem",
        "timezone",
        "modification_date",
    ]

# "admin1 codes" refer to things like states or provinces.
# "admin2" would be counties and similar, which we won't trouble ourselves with at this point.

# Download the admin1codes from geonames.
# Return: {country_code: {admin1_code: admin1_name}}
#   I.e.: {"US":         {"MN":        "Minnesota"}}
def fetch_admin1_names():

    # https://download.geonames.org/export/dump/
    # admin1CodesASCII.txt: names in English for admin divisions. Columns: code, name, name ascii, geonameid

    class Admin1Row(Row):
        column_names = ["code", "name", "name_ascii", "geonameid"]

    admin1_csv_f = StringIO(requests.get("https://download.geonames.org/export/dump/admin1CodesASCII.txt").content.decode('utf-8'))
    admin1_reader = csv.reader(admin1_csv_f, delimiter='\t')

    admin1_names = defaultdict(dict)
    for row_ in admin1_reader:
        row = Admin1Row(row_)
        # row['code'] looks something like: "AD.06"
        country_code, admin1_code = row['code'].split('.')

        assert row["name"] not in admin1_names[country_code].values(), "Duplicate admin1 within country: " + repr(row)
        admin1_names[country_code][admin1_code] = row["name"]

    return admin1_names

def validate_city_row(city_row):
    # Make sure all cities have a country code (Adding this here because some
    # things in the data aren't 100% as expected. I just wanted to make sure
    # that this isnt' one of those things).
    assert row["country_code"], "Oops, I guess some cities don't have a country: " + repr(row)

def get_admin1_name(country_code, admin1_code):
    if admin1_code and admin1_code in admin1_names[country_code]:
        return admin1_names[country_code][admin1_code]
    else:
        # The city claims to have an admin1_code and country_code combination that isn't in
        # admin1_names. I don't know what to do with it so let's just say it has no admin1_code.
        print("admin1_code " + row["admin1_code"] + " not found for country " + row["country_code"])
        return None

# Counts cities with and without admin1 for each country. For most countries,
# either all cities have admin1 or none of them do. This is good for a
# consistent experience for the user. But, there are exceptions. I'm not sure
# what if anything to do about it, but I at least want to keep track.
admin1_code_counts = namedtuple("admin1_code_counts", ["with_admin1_count", "no_admin1_count"])
country_admin1_stats = defaultdict(lambda : admin1_code_counts(0, 0))
def update_country_admin1_stats(city_id):
    with_admin1_count, no_admin1_count = country_admin1_stats[city_id.country]

    if city_id.admin1:
        with_admin1_count += 1
    else:
        no_admin1_count += 1

    country_admin1_stats[city_id.country] = admin1_code_counts(with_admin1_count, no_admin1_count)

def print_country_admin1_stats():
    print ("List of countries where all of the admin1 codes are missing")
    for country_code, admin1_code_counts in country_admin1_stats.items():
        if admin1_code_counts.with_admin1_count == 0:
            print(country_code, admin1_code_counts)
    print ("List of countries where some (but not all) of the admin1 codes are missing")
    for country_code, admin1_code_counts in country_admin1_stats.items():
        if admin1_code_counts.no_admin1_count != 0 and admin1_code_counts.with_admin1_count != 0:
            print(country_code, admin1_code_counts)

def make_city_identifier(row):
    """ Turn a city row into a `city_identifier`, which uniquely identifies a city"""
    return city_identifier(
        name=row["name"],
        admin1=get_admin1_name(row["country_code"], row["admin1_code"]),
        country=row["country_code"],

        # admin2=...
        #
        # When we're ready: We could choose to add it to an entry only when we need it for deduping
        # purposes. Or, we could always include it and let the front end hide it from search results
        # if it's not needed for deduping, but show it when they click on the Marker. However, I
        # don't know if the front end would easily be able to tell if it's needed for deduping, so
        # we should probably mark it somehow here. A "dedupe" field that could say "admin2", "admin1",
        # "country", or even "city". Whatever is the lowest level of specificity it needs to dedupe.
    )

def make_city(city_id, row):
    city = {
        "lat": row["latitude"],
        "lon": row["longitude"],
        "pop": row["population"],
        **city_id._asdict()
    }
    if not city['admin1']:
        del city['admin1']
    return city

def get_token_prefixes(city_id, prefix_length):
    """For a given city, give me all the prefixes that will eventually become
    file names that the city will go into"""

    # TODO - sub-prefix_length names?
    # TODO - sub-prefix_length partial matches - with high population cutoff, AND exact matches for tokens... but only if all the tokens are short? hmm.
    # TODO - Also sure maybe we do enforce a min-length ("du", "of" ? not useful) unless there are no long words in the thing! Or something.
    token_prefixes = set()

    # All of these components will be searchable, even if not with the same priority
    for name_component in [city_id.name, city_id.admin1 or "", city_id.country]:
        # We hope to clean and split the searchable components the same way as in the
        # search engine. We only care about that here because we want to make
        # sure the correct file comes up when the user starts typing a name.

        # These should be characters that function the same way as diacritics.
        # Stuff that should not split a term in two. Rather, stuff we could
        # reasonably ignore and it would keep a word intact with the same meaning.
        ignored_characters = ['`', '\u02bb', '\'']

        # Normalize each character
        cleaned_name_component = u"".join([
            c for c
            in unicodedata.normalize('NFD', name_component) # ?
            if not unicodedata.combining(c) and c not in ignored_characters
        ]).lower()

        # Split into tokens (words-ish) and get each prefix
        token_prefixes |= {
            t[:prefix_length] for t
            in regex.split('[^\p{L}|^\p{N}]+', cleaned_name_component)
            if t # don't want 0-length prefixes
        }
    return token_prefixes

def write_cities(cities):
    TMP_OUTPUT_DIR = "output"

    if not os.path.exists(TMP_OUTPUT_DIR):
        os.mkdir(TMP_OUTPUT_DIR)

    outfile_data = defaultdict(list)

    for city_id, entry in cities.items():

        prefix_length = 3

        prefixes = get_token_prefixes(city_id, prefix_length)
        assert prefixes, f"{city_id} has no prefixes"
        for prefix in prefixes:
            outfile_data[prefix].append(entry)

    for prefix, entries in outfile_data.items():
        with gzip.open(os.path.join(TMP_OUTPUT_DIR, f"{prefix}.json.gz"), "wt") as outfile:
            outfile.write(json.dumps(entries, indent=2))
    with gzip.open(os.path.join(TMP_OUTPUT_DIR, "index_metadata.json.gz"), "wt") as outfile:
        outfile.write(json.dumps({
            "stopwords": [""],
            "token_length": 3,
            "num_cities": len(cities),
        }, indent=2))

    tar = tarfile.open(f"static-search.{date.today()}.pop-1k-cities.tar.gz", "w:gz")
    for name in os.listdir(TMP_OUTPUT_DIR):
        tar.add(os.path.join(TMP_OUTPUT_DIR, name))
    tar.close()

# TODO Add full country names if short (yes for "Italy", not for "The United States of America")
# TODO actually keep full country names AND country codes. But maybe *display* country codes if country name is long.
# TODO Add countries as searchable entities.
# * Gather all of the cities in that country and pick one with a "median" location (want to pick one to make sure it's in the country in question)
# TODO admin1s too, why not. "Minnesota".
# TODO keep admin1 codes too if they're human friendly? for searching.

admin1_names = fetch_admin1_names()
zip_data = BytesIO(requests.get("https://download.geonames.org/export/dump/cities1000.zip").content)

with zipfile.ZipFile(zip_data, "r") as zf:
    csv_f = TextIOWrapper(zf.open("cities1000.txt", "r"), encoding='utf-8')
    reader = csv.reader(csv_f, delimiter='\t')

    cities = {}
    for row_ in reader:
        row = CitiesRow(row_)

        validate_city_row(row)
        city_id = make_city_identifier(row)
        update_country_admin1_stats(city_id)

        if city_id in cities:
            pop1 = row["population"]
            pop2 = cities[city_id]["pop"]
            print(f"Dupe city_id: {city_id} populations: {pop1} vs {pop2}")

        if city_id not in cities or int(cities[city_id]["pop"]) < int(row["population"]):
            cities[city_id] = make_city(city_id, row)

    print_country_admin1_stats()
    write_cities(cities)
