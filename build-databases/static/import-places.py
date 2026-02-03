import csv, gzip, regex, requests, json, os, tarfile, unicodedata, zipfile
from io import BytesIO, StringIO, TextIOWrapper
from collections import defaultdict

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
def get_admin1_mapping():

    # https://download.geonames.org/export/dump/
    # admin1CodesASCII.txt: names in English for admin divisions. Columns: code, name, name ascii, geonameid

    class Admin1Row(Row):
        column_names = ["code", "name", "name_ascii", "geonameid"]

    admin1_csv_f = StringIO(requests.get("https://download.geonames.org/export/dump/admin1CodesASCII.txt").content.decode('utf-8'))
    admin1_reader = csv.reader(admin1_csv_f, delimiter='\t')

    admin1_mapping = defaultdict(dict)
    for row_ in admin1_reader:
        row = Admin1Row(row_)
        # row['code'] looks something like: "AD.06"
        country_code, admin1_code = row['code'].split('.')

        assert row["name"] not in admin1_mapping[country_code].values(), "Duplicate admin1 within country: " + repr(row)
        admin1_mapping[country_code][admin1_code] = row["name"]

    return admin1_mapping

def assert_city_has_country(city_row):
    # Make sure all cities have a country code (Adding this here because some
    # things in the data aren't 100% as expected. I just wanted to make sure
    # that this isnt' one of those things).
    assert row["country_code"], "Oops, I guess some cities don't have a country: " + repr(row)

# Make sure we have no countries where some cities have Admin1 codes
# and and some do not. It would create an inconsistent experience
# with two formats ("City, Admin1, CountryCode" vs "City, CountryCode")
# especially if there are duplicate city names with different formats.
#
# Fortunately it's only in rare cases that this inconsistency happens.
# I'll just name them here, and remove the admin1_code for those
# countries. In theory, removing Admin1 could inadvertently create more
# duplicates in the process. We'll confirm that we didn't do this.
#
# TODO - Assert that the admin1_problem_country_codes countries actually
# have both formats. If not, we can remove it from the list.
# TODO - Comment that sometimes we remove admin1_code if it doesn't point to anything.
admin1_problem_country_codes = ["MR"] # TODO - try removing this

# Remove admin1_code if either:
# * It's a "problem country" where not all cities have admin1_codes
# * It doesn't refer to anything in the admin1_mapping
def clean_admin1_code_for_city(city_row):
    admin1_code = row["admin1_code"]
    if admin1_code not in admin1_mapping[row["country_code"]]:
        # The city claims to have an admin1_code and country_code combination that isn't in
        # admin1_mapping.  don't know what to do with it so let's just say it has no admin1_code.
        print("admin1_code " + row["admin1_code"] + " not found for country " + row["country_code"])
        row["admin1_code"] = ""
    if row["country_code"] in admin1_problem_country_codes:
        # The city claims to have a country_code that doesn't hvae
        # We don't know what to do with it so let's just say it has no admin1_code.
        row["admin1_code"] = ""

# Check that each country either has admin1codes for all
# cities, or for no cities (after we remove some of them
# in clean_admin1_code_for_city)
countries_have_admin1_code = {}
def check_country_admin1_consistency(city_row):
    has_admin1_code = bool(row["admin1_code"])
    if countries_have_admin1_code.get(row["country_code"]) == (not has_admin1_code):
        raise Exception(row["country_code"] + " has some but not all cities without admin1_code")
    countries_have_admin1_code[row["country_code"]] = has_admin1_code

# TODO - actually don't put the country and state name in the queryable stuff? It'll grab a bunch of unwanted things. Maybe they should be different fields.
#    * That way I can add admin2 admin3 admin4 etc etc. Though don't if not necessary to dedupe?
#    * I guess it's "match name, then match admin1 or admin2 or country etc."
#    * But it should continue to show the full name because the geocoder thing displays it well.
def city_display_name(row):
    if row["admin1_code"]:
        # We have the admin1_code, include it in the display_name
        return ", ".join([
            row["name"],
            admin1_mapping[row["country_code"]][row["admin1_code"]],
            row["country_code"]
        ])
    else:
        # We don't have the admin1_code, we can't include it in the display_name
        return ", ".join([
            row["name"],
            row["country_code"]
        ])

def write_cities(cities):
    TMP_OUTPUT_DIR = "output"

    if not os.path.exists(TMP_OUTPUT_DIR):
        os.mkdir(TMP_OUTPUT_DIR)

    outfile_data = defaultdict(list)

    for display_name, properties in cities.items():
        entry = {
            "lat": properties["latitude"],
            "lon": properties["longitude"],
            "pop": properties["population"],
            'name': display_name,
        }

        prefix_length = 3

        # We hope to clean and split the display name the same way as in the
        # search engine. We only care about that here because we want to make
        # sure the file names are correct. But, that does affect which file
        # name comes up.
        cleaned_display_name = u"".join([
            c for c
            in unicodedata.normalize('NFKD', display_name)
            if not unicodedata.combining(c)
        ]).lower()
        token_prefixes = {
            t[:prefix_length] for t
            in regex.split('[^\p{L}]+', cleaned_display_name)
        }

        # TODO - sub-prefix_length names?
        # TODO - sub-prefix_length partial matches - with high population cutoff, AND exact matches for tokens... but only if all the tokens are short? hmm.
        # TODO - Also sure maybe we do enforce a min-length ("du", "of" ? not useful) unless there are no long words in the thing! Or something.
        for prefix in token_prefixes:
            outfile_data[prefix].append(entry)

    for prefix, entries in outfile_data.items():
        with gzip.open(os.path.join(TMP_OUTPUT_DIR, f"{prefix}.json.gz"), "wt") as outfile:
            outfile.write(json.dumps(entries, indent=2))
    with gzip.open(os.path.join(TMP_OUTPUT_DIR, f"index_metadata.json.gz"), "wt") as outfile:
        outfile.write(json.dumps({"stopwords": [""], "token_length": 3}, indent=2))

    tar = tarfile.open("static-search.2025-12-10.pop-1k-cities.tar.gz", "w:gz")
    for name in os.listdir(TMP_OUTPUT_DIR):
        tar.add(os.path.join(TMP_OUTPUT_DIR, name))
    tar.close()

# TODO Add full country names if short (yes for "Italy", not for "The United States of America")
# TODO Add countries as searchable entities.
# * Gather all of the cities in that country and pick one with a "median" location (want to pick one to make sure it's in the country in question)
# TODO admin1s too, why not. "Minnesota".

admin1_mapping = get_admin1_mapping()
zip_data = BytesIO(requests.get("https://download.geonames.org/export/dump/cities1000.zip").content)

with zipfile.ZipFile(zip_data, "r") as zf:
    csv_f = TextIOWrapper(zf.open("cities1000.txt", "r"), encoding='utf-8')
    reader = csv.reader(csv_f, delimiter='\t')
    cities = defaultdict(dict)

    for row_ in reader:
        row = CitiesRow(row_)

        assert_city_has_country(row)
        clean_admin1_code_for_city(row)
        display_name = city_display_name(row)

        if display_name not in cities or cities[display_name]['population'] < row["population"]:
            cities[display_name] = {
                "population": row["population"],
                "latitude": row["latitude"],
                "longitude": row["longitude"],
            }
        else:
            print(
                "Dupe city/country/admin1_code: " + display_name +
                " populations: " + row["population"] + " vs " + cities[display_name]["population"]
            )

    write_cities(cities)
