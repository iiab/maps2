import { deepStrictEqual } from 'assert';
import { AddressTextualIndex } from "./static_search.js";
import { fsFetchJson, listIndexFiles, MockMap } from "./base.js";

// Number of visible results when searching for something. We generally
// want to make sure that what we're looking for is visible.
const visibleResultsSize = 5

// This function turns an entry into a unique string that identifies it.
// static_search.js has the same logic.
const getEntryId = item => `${item.name}...${item.admin1 || ""}...${item.country}...${item.pop || 0}...${item.lat}...${item.lon}`

async function expectFirstResults(engine, query, want) {
    let result

    try {
      result = await engine.search(query, {queryTokens: true, matching: false, sorting: true, candidateTokens: false})
    } catch (err) {
      throw JSON.stringify({
        query, want, debugOut: engine.debugOut
      }, null, 2) + "\n" + err.stack
    }
    if (result.length === 0) {
      throw "Query got no results:\n" + JSON.stringify({query, want, debugOut: engine.debugOut}, null, 2)
    }
    // `got` should be the first so many items of `results`,
    // and it should be the same length as `want`. If there
    // are fewer results available, it will just contain all of the results.
    const got = result.slice(0, want.length).map(r => ({
      name: r["name"],
      admin1: r["admin1"],
      country: r["country"],
    }))
    deepStrictEqual(got, want, JSON.stringify({
      query, want, got, result: result.slice(0, 5), debugOut: engine.debugOut}, null, 2)
    )

    // return stuff for subsequent tests
    return {
      entry: result[0],
      sortFactors: engine.debugOut.sortFactors,
    }
}

function expectPreviousQuerySortFactor(sortFactors, entry, factorName, want, query) {
    deepStrictEqual(
      want,
      sortFactors[getEntryId(entry)][factorName],
      JSON.stringify({sortFactors, entry, factorName, query}, null, 2),
    )
}

async function expectEmpty(engine, query) {
    await deepStrictEqual((await engine.search(query)).length, 0)
}

async function testBasic({engine}) {
    console.log("testBasic")

    // The query "yor" matches New York City despite many cities named York and many cities in New York state.
    // (Note that we want to avoid exact matches to avoid relying on that sorting factor.)
    await expectFirstResults(engine, "yor", [{
      name: "New York City",
      admin1: "New York",
      country: "US",
    }])

    // Nonsense match gets us nothing
    await expectEmpty(engine, "ZZZ")
}

async function testWeirdCharacters({engine}) {
    // These are a couple characters that gave us trouble before. They are in
    // the beginning of the first word, leading the entry to not show up in the
    // database file that corresponds to the first word.
    // Note that here we are not concerned with sorting, but whether we can
    // reach the result at all. We might rely on "exact sorting" factor here
    // but we are not testing that it works.
    // Also note that the resolution to this issue is in the generation of the
    // database rather than the querying.
    console.log("testWeirdCharacters")

    // Try searching with and without the backtick (and also try without any diacritics,
    // for the heck of it)
    // We put in a term for the admin1 to disambiguate
    for (const query of ["ta`\u016b manu", "ta\u016b manu", "tau manu"]) {
      await expectFirstResults(engine, query, [{
        name: "Ta`\u016b",
        admin1: "Manu'a",
        country: "AS",
      }])
    }

    // Try searching with and without the fancy single quote (\u02bb) (and also try
    // without any diacritics, for the heck of it)
    for (const query of ["Ha\u02bbik\u016b", "haik\u016b", "haiku"]) {
      await expectFirstResults(engine, query, [{
        name: "Ha\u02bbik\u016b",
        admin1: "Hawaii",
        country: "US"
      }])
    }

    // Try searching with and without the single quote
    for (const query of ["N'dalatando", "Ndalatando"]) {
      await expectFirstResults(engine, query, [{
        name: "N'dalatando",
        admin1: "Cuanza Norte",
        country: "AO"
      }])
    }

    // Try searching with two, one, and zero single quotes.
    // We had a bug if two single quotes were in the entry
    for (const query of ["Ca' d'Andrea", "d'Andrea", "dandrea"]) {
      await expectFirstResults(engine, query, [{
        name: "Ca' d'Andrea",
        admin1: "Lombardy",
        country: "IT",
      }])
    }
}

async function testExactMatchFactor({engine}) {
    console.log("testExactMatchFactor")
    let result, entry, sortFactors, query

    // Aber, Wales is an entry that (for whatever reason) has a zero population, at
    // least in the latest data as of this writing. "Aber" also happens to be the beginning
    // of the names of many other towns in Wales. (Aberystwyth, Abertillery, Aberporth,
    // etc) Thus, without the exact_match_factor, searching for this query would put Aber,
    // Wales at the end of the results, i.e. not visible to the user.

    query = "Aber Wales GB";
    ({entry, sortFactors} = await expectFirstResults(engine, query, [{
      name: "Aber",
      admin1: "Wales",
      country: "GB",
    }]))
    expectPreviousQuerySortFactor(sortFactors, entry, 'exact_match_factor', 12, query)

    // If I search for most of (not exactly) "Washington" I get Seattle in the first
    // couple results because it has the highest population among them. (Washington DC
    // is a very close second, and distance factor can make that show up before Seattle)
    result = await engine.search("washingto", {matching: false, sorting: true})
    const [seattle] = result.slice(0, 2).filter(r => r.name === "Seattle")
    deepStrictEqual(
      Boolean(seattle), true, JSON.stringify({result: result, debugOut: engine.debugOut}, null, 2),
    )

    // If I search for *exactly* "Washington" I get a bunch of cities called "Washington"
    // before I get Seattle because city name takes precedence before admin1.
    result = await engine.search("washington", {matching: false, sorting: true})
    deepStrictEqual(
      result.slice(0,10).map(entry => entry.name),
      Array(10).fill("Washington"),
      JSON.stringify({result: result.slice(0, 10), debugOut: engine.debugOut}, null, 2),
    )

    // If I search for an entry with no admin1, I don't want to get the bonus
    // of adding an admin1.
    query = "dover"
    result = await engine.search(query, {matching: false, sorting: true});
    const [dover_sg] = result.filter(r => r.name === "Dover" && r.country === "SG")

    // Make sure we got the expected exact_match_factor
    expectPreviousQuerySortFactor(
      engine.debugOut.sortFactors, dover_sg, 'exact_match_factor', 8, query
    )
}

async function testNumbers({engine}) {
    console.log("testNumbers")

    // Now we're going to test some similar looking towns (and/or Universities?)
    // with numbers in the name to make sure I get the expected score, assuming
    // we're even supposed to match.

    // A convenience function
    const checkLyon = (query, result, testLyon, expectedScore) => {
        // Make sure we got the expected exact_match_factor
        expectPreviousQuerySortFactor(
          engine.debugOut.sortFactors, testLyon, 'exact_match_factor', expectedScore, query
        )
    }
    let lyon, lyon_02, lyon_08, result, query

    query = "Lyon"
    result = await engine.search(query, {matching: false, sorting: true});
    [lyon] = result.filter(r => r.name === "Lyon");
    [lyon_02] = result.filter(r => r.name === "Lyon 02");
    [lyon_08] = result.filter(r => r.name === "Lyon 08")
    checkLyon(query, result, lyon, 8)    // Exact match of city name
    checkLyon(query, result, lyon_02, 0) // "Lyon" is merely part of "Lyon 02"
    checkLyon(query, result, lyon_08, 0) // "Lyon" is merely part of "Lyon 08"

    query = "Lyon 02"
    result = await engine.search(query, {matching: false, sorting: true});
    [lyon] = result.filter(r => r.name === "Lyon");
    [lyon_02] = result.filter(r => r.name === "Lyon 02");
    [lyon_08] = result.filter(r => r.name === "Lyon 08")
    deepStrictEqual(lyon, undefined)      // "Lyon 02" includes "02" which is not present in "Lyon" so no match
    deepStrictEqual(lyon_08, undefined)   // "Lyon 02" includes "02" which is not present in "Lyon 08" so no match
    checkLyon(query, result, lyon_02, 8)  // Exact match of city name
}

async function testDistanceFactor({engine}) {
    console.log("testDistanceFactor")

    // Test searching for "dover" when pointing our map right at Dover England,
    // Dover New Hampshire, and Dover Delaware. Expect the nearest Dover to
    // show up first in the results.

    let query

    query = "dover"

    engine.map.setCenter({lat: 50, lng: 0})
    await expectFirstResults(engine, query, [{
      name: "Dover",
      admin1: "England",
      country: "GB",
    }])

    engine.map.setCenter({lat: 40, lng: -75})
    await expectFirstResults(engine, query, [{
      name: "Dover",
      admin1: "Delaware",
      country: "US",
    }])

    engine.map.setCenter({lat: 43, lng: -70})
    await expectFirstResults(engine, query, [{
      name: "Dover",
      admin1: "New Hampshire",
      country: "US",
    }])

    // If I'm looking directly at Paris, Texas and search for "paris", my first two results should be:
    // 1) Paris, Texas (Population ~24,000)
    // 2) Paris, France (Population ~2,000,000)
    //
    // However if I veer off to New Orleans, Louisiana, then Paris France should overtake Paris, Texas
    //
    // On the other hand, Paris, Idaho has a population of 500. Even if you're looking at it,
    // Paris, France shows up first, but at least Paris, Idaho shows up second.

    query = "paris"

    // Near Paris, Texas
    engine.map.setCenter({lat: 34, lng: -95})
    await expectFirstResults(engine, query, [{
      name: "Paris",
      admin1: "Texas",
      country: "US",
    }, {
      name: "Paris",
      admin1: "\u00cele-de-France",
      country: "FR",
    }])

    // Near New Orleans, Louisiana (far but not super far from Paris, Texas)
    engine.map.setCenter({lat: 30, lng: -90})
    await expectFirstResults(engine, query, [{
      name: "Paris",
      admin1: "\u00cele-de-France",
      country: "FR",
    }, {
      name: "Paris",
      admin1: "Texas",
      country: "US",
    }])

    // Near Paris, Idaho
    engine.map.setCenter({lat: 42, lng: -111})
    await expectFirstResults(engine, query, [{
      name: "Paris",
      admin1: "\u00cele-de-France",
      country: "FR",
    }, {
      name: "Paris",
      admin1: "Idaho",
      country: "US",
    }])
}

async function testPopulationFactor({engine}) {
    console.log("testPopulationFactor (TODO)")
}

// Test that every name in the search index is searchable with our current
// engine. Unique or populous cities are easy to find. Obscure cities with
// common names may be tough. That's why we make sure that everything is
// findable, i.e. in the visible results (first 5 or so), when the user
// searches for city name and admin1 (and if admin1 doesn't exist, city name
// and country name).
//
// While searching with country name may be a common way to try to find obscure
// cities, it may not always be sufficient. But we do hope that searching with
// admin1 (state name) or country name is sufficient. I.e. we don't ever want it
// to be necessary to include both. On the other hand, once our data includes all
// the towns called "Franklin" in Pennsylvania, we might have to start looking at
// admin2 (county name).
//
// We also rely on the "exact match factor" here in the background. So, in some cases
// it will probably be necessary to make an exact match to find something.
//
// The `filter` is there to split our corpus so that we can have multiple tests for
// different categories of entries (as of this writing, we're splitting between those
// having short first terms and those not). Perhaps this will go away and we'll have
// just one test once we fix everything.
async function testReachability({engine, indexMetadata, outputDir}) {
    console.log("testReachability")

    // Get the token length from the metadata file within the database
    const fileTokenLength = Number(indexMetadata['token_length'])

    const seen = new Set()

    for (const file of listIndexFiles(outputDir)) {
        const fileEntries = await (await fsFetchJson(file)).json()

        // console.log(`reachability: looking for ${fileEntries.length} entries in ${file}`)
        for (const entry of fileEntries) {
            entry.entryId = getEntryId(entry)
            if (seen.has(entry.entryId)) {
                continue
            }
            seen.add(entry.entryId)

            const query = entry.admin1 ? `${entry.name} ${entry.admin1}` : `${entry.name} ${entry.country}`

            // Go to the opposite side of the world. We should be able to find
            // it even with other places having location bias
            if (Number(entry.lon) > 0) {
              engine.map.setCenter({lat: -Number(entry.lat), lng: Number(entry.lon) - 180})
            } else {
              engine.map.setCenter({lat: -Number(entry.lat), lng: Number(entry.lon) + 180})
            }

            let result
            try {
              result = await engine.search(query, {queryTokens: true})
            } catch (err) {
              throw JSON.stringify({
                  fromFile: file.split('/').slice(-1),
                  debugOut: engine.debugOut,
                  query,
                  result,
                  want: entry,
              }, null, 2) + "\n" + err.stack
            }
            const visibleResults = result.slice(0, visibleResultsSize)
            for (const x of visibleResults) {
                x.entryId = getEntryId(x)
            }
            const errOut = JSON.stringify({
                fromFile: file.split('/').slice(-1),
                debugOut: engine.debugOut,
                query,
                result,
                want: entry,
            }, null, 2)

            // Let's confirm that the entry shows up in visible results
            deepStrictEqual(Boolean(visibleResults.length), true, errOut)
            deepStrictEqual(visibleResults.some(r => entry.entryId == r.entryId), true, errOut)

            // Let's also double check that the entry meets some other assumptions.
            // Not checking if entry.admin1 is truthy; it's optional
            deepStrictEqual(Boolean(entry.name.length), true, errOut)
            deepStrictEqual(Boolean(entry.country.length), true, errOut)
            deepStrictEqual(Boolean(entry.lat.length), true, errOut)
            deepStrictEqual(Boolean(entry.lon.length), true, errOut)
            deepStrictEqual(Boolean(entry.pop.length), true, errOut)
        }
    }
}

async function testShortTokens({engine}) {
    console.log("testShortTokens")

    // Our target token size is 3 but we have stuff that's smaller. It's handled
    // differently. Let's make sure it works in queries with only smaller terms.

    for (const query of ["S\u00e9 MO", "se mo"]) {
        await expectFirstResults(engine, query, [{
          name: "S\u00e9",
          admin1: undefined,
          country: "MO"
        }])
    }

    // "ne br" will return New Brunswick because it's in ne.json (we're pretending
    // that it's a high ranking entry that made it into the two-letter files)
    await expectFirstResults(engine, "ne br", [{
      name: "New Brunswick",
      admin1: "New Jersey",
      country: "US"
    }])

    // "ne bri" will return New Brighton because bri has three characters and will lead it to look in bri.json
    await expectFirstResults(engine, "ne bri", [{
      name: "New Brighton",
      admin1: "Alberta",
      country: "CA"
    }])
}

async function makeSetup(outputDir) {
    const map = new MockMap()
    const engine = new AddressTextualIndex({map, baseURL: outputDir, fetcher: fsFetchJson})
    const indexMetadata = await (await fsFetchJson(`${outputDir}/index_metadata.json`)).json()
    return {outputDir, engine, indexMetadata}
}

async function main() {
    const realOutputDir = "../output"  // Real data that we want to test for problems
    const testOutputDir = "testDB"     // Test data (based on real data) that's useful to test for edge cases

    const testDBSetup = await makeSetup(testOutputDir)
    const realDBSetup = await makeSetup(realOutputDir)

    await testBasic(realDBSetup)
    await testExactMatchFactor(testDBSetup)
    await testNumbers(testDBSetup)
    await testWeirdCharacters(realDBSetup) // real DB because we want to make sure that the database generator puts things in the right json file
    await testDistanceFactor(testDBSetup)
    await testPopulationFactor(testDBSetup)
    await testShortTokens(testDBSetup)
    await testReachability(realDBSetup)
}

main()
.catch(e => {console.error(e)});
