/*
 * TODO:
 *
 * Go through the database, make sure that:
 *   * the normalization matches the Python normalization
 *   * most importantly: the file name matches the first X characters of each name. i.e. make sure I can reach each result
 *
 * Test sorting:
 *   * Make sure the different sorting methods give me what I expect. Make test cases that I can run as I add more complicated sorting.
 *   * Check out the repo and grab the js file as-is to make sure the test is accurate.
*/

import { deepStrictEqual } from 'assert';
import { AddressTextualIndex } from "./static_search.js";
import { fsFetchJson, listIndexFiles } from "./base.js";

class MockMap {
  constructor() {
    this.center = {lng: 0, lat: 0}
  }
  getCenter() {
    return this.center
  }
  setCenter(center) {
    this.center = center
  }
}

// Number of visible results when searching for something. We generally
// want to make sure that what we're looking for is visible.
const visibleResultsSize = 5

// Determine whether to skip the entry.
// Allow for tests that skip certain entries based on token length.
function skipEntry(
  entry,             // the thing being searched for
  fileTokenLength,   // length of token prefix used for (ideal) json file names (for short names, actual files could be shorter!)
  filter,            // based on the fileTokenLength, the actual file token, and maybe other
) {
    // Base filename for search index shard. i.e. <fileToken>.json
    //
    // Generally we don't want to replicate this "file token" logic because it's
    // part of what we are testing in the production code. However, in this case
    // it's only for the purpose of splitting the test cases into groups. At the
    // end of the day, we want them all to pass regardless, and we could ideally
    // remove this function entirely.
    const fileToken = entry['name'].normalize("NFD").replace(/\p{Diacritic}/gu, "")
                       .replace(/^[^\p{N}|\p{L}]+/u, '')
                       .replace("'", '')
                       .split(/[^\p{L}]+/u)[0]

    if (!filter({fileToken, fileTokenLength})) {
        // console.log('no', fileToken, fileToken.length, entry['name'])
        return true
    }

    // console.log('yes', fileToken, fileToken.length, entry)
    return false
}

// This function turns an entry into a unique string that identifies it.
// static_search.js has the same logic.
const getEntryId = item => `${item.name}...${item.admin1 || ""}...${item.country}...${item.pop || 0}...${item.lat}...${item.lon}`

async function expectFirstResult(engine, query, want) {
    const result = await engine.search(query)
    const got = {
      name: result[0]["name"],
      admin1: result[0]["admin1"],
      country: result[0]["country"],
    }
    deepStrictEqual(got, want, JSON.stringify({
      query, want, got, result: result.slice(0, 5), debugOut: engine.debugOut}, null, 2)
    )
}

async function expectEmpty(engine, query) {
    await deepStrictEqual((await engine.search(query)).length, 0)
}

async function testBasic({engine}) {
    console.log("testBasic")

    // The query "yor" matches New York City despite many cities named York and many cities in New York state.
    // (Note that we want to avoid exact matches to avoid relying on that sorting factor.)
    await expectFirstResult(engine, "yor", {
      name: "New York City",
      admin1: "New York",
      country: "US",
    })

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
      await expectFirstResult(engine, query, {
        name: "Ta`\u016b",
        admin1: "Manu'a",
        country: "AS",
      })
    }

    // Try searching with and without the fancy single quote (\u02bb) (and also try
    // without any diacritics, for the heck of it)
    for (const query of ["Ha\u02bbik\u016b", "haik\u016b", "haiku"]) {
      await expectFirstResult(engine, query, {
        name: "Ha\u02bbik\u016b",
        admin1: "Hawaii",
        country: "US"
      })
    }

    // Try searching with and without the single quote
    for (const query of ["N'dalatando", "Ndalatando"]) {
      await expectFirstResult(engine, query, {
        name: "N'dalatando",
        admin1: "Cuanza Norte",
        country: "AO"
      })
    }
}

async function testExactMatchFactor({engine}) {
    console.log("testExactMatchFactor")
    let result

    // Aber, Wales is an entry that (for whatever reason) has a zero population, at
    // least in the latest data as of this writing. "Aber" also happens to be the beginning
    // of the names of many other towns in Wales. (Aberystwyth, Abertillery, Aberporth,
    // etc) Thus, without the exact_match_factor, searching for this query would put Aber,
    // Wales at the end of the results, i.e. not visible to the user.
    result = await engine.search("Aber Wales GB", {matching: false, sorting: true})
    const want = {
      name: "Aber",
      admin1: "Wales",
      country: "GB",
    }
    const got = {
      name: result[0]["name"],
      admin1: result[0]["admin1"],
      country: result[0]["country"],
    }

    // Make sure we got the right one
    deepStrictEqual(
      got, want, JSON.stringify({want, got, result, debugOut: engine.debugOut}, null, 2),
    )
    // Make sure we got the expected exact_match_factor
    deepStrictEqual(
      engine.debugOut.sortFactors[getEntryId(result[0])]['exact_match_factor'],
      12,
      JSON.stringify({want, got, result, debugOut: engine.debugOut}, null, 2),
    )

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
    result = await engine.search("dover", {matching: false, sorting: true});
    const [dover_sg] = result.filter(r => r.name === "Dover" && r.country === "SG")

    // Make sure we got the expected exact_match_factor
    deepStrictEqual(
      engine.debugOut.sortFactors[getEntryId(dover_sg)]['exact_match_factor'],
      8,
      JSON.stringify({debugOut: engine.debugOut}, null, 2),
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
        deepStrictEqual(
          engine.debugOut.sortFactors[getEntryId(testLyon)]['exact_match_factor'],
          expectedScore,
          JSON.stringify({query, result, debugOut: engine.debugOut}, null, 2),
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

    let result, query, want, got

    engine.map.setCenter({lat: 50, lng: 0})
    result = await engine.search("dover", {matching: false, sorting: true})
    want = {
      name: "Dover",
      admin1: "England",
      country: "GB",
    }
    got = {
      name: result[0]["name"],
      admin1: result[0]["admin1"],
      country: result[0]["country"],
    }
    deepStrictEqual(got, want, JSON.stringify({
      want, got, result: result.slice(0, 5), debugOut: engine.debugOut}, null, 2)
    )

    engine.map.setCenter({lat: 40, lng: -75})
    result = await engine.search("dover", {matching: false, sorting: true})
    want = {
      name: "Dover",
      admin1: "Delaware",
      country: "US",
    }
    got = {
      name: result[0]["name"],
      admin1: result[0]["admin1"],
      country: result[0]["country"],
    }
    deepStrictEqual(got, want, JSON.stringify({
      want, got, result: result.slice(0, 5), debugOut: engine.debugOut}, null, 2)
    )

    engine.map.setCenter({lat: 43, lng: -70})
    result = await engine.search("dover", {matching: false, sorting: true})
    want = {
      name: "Dover",
      admin1: "New Hampshire",
      country: "US",
    }
    got = {
      name: result[0]["name"],
      admin1: result[0]["admin1"],
      country: result[0]["country"],
    }
    deepStrictEqual(got, want, JSON.stringify({
      want, got, result: result.slice(0, 5), debugOut: engine.debugOut}, null, 2)
    )

    // If I'm looking directly at Paris, Texas and search for "paris", my first two results should be:
    // 1) Paris, Texas (Population ~24,000)
    // 2) Paris, France (Population ~2,000,000)
    //
    // However if I veer off to New Orleans, Louisiana, then Paris France should overtake Paris, Texas
    //
    // On the other hand, Paris, Idaho has a population of 500. Even if you're looking at it,
    // Paris, France shows up first, but at least Paris, Idaho shows up second.

    engine.map.setCenter({lat: 34, lng: -95}) // Near Paris, Texas
    result = await engine.search("paris", {matching: false, sorting: true})
    want = [{
      name: "Paris",
      admin1: "Texas",
      country: "US",
    }, {
      name: "Paris",
      admin1: "\u00cele-de-France",
      country: "FR",
    }]
    got = result.slice(0, 2).map(r => ({
      name: r.name,
      admin1: r.admin1,
      country: r.country,
    }))
    deepStrictEqual(got, want, JSON.stringify({
      want, got, result: result.slice(0, 5), debugOut: engine.debugOut}, null, 2)
    )

    engine.map.setCenter({lat: 30, lng: -90}) // Near New Orleans, Louisiana (far but not super far from Paris, Texas)
    result = await engine.search("paris", {matching: false, sorting: true})
    want = [{
      name: "Paris",
      admin1: "\u00cele-de-France",
      country: "FR",
    }, {
      name: "Paris",
      admin1: "Texas",
      country: "US",
    }]
    got = result.slice(0, 2).map(r => ({
      name: r.name,
      admin1: r.admin1,
      country: r.country,
    }))
    deepStrictEqual(got, want, JSON.stringify({
      want, got, result: result.slice(0, 5), debugOut: engine.debugOut}, null, 2)
    )

    engine.map.setCenter({lat: 42, lng: -111}) // Near Paris, Idaho
    result = await engine.search("paris", {matching: false, sorting: true})
    want = [{
      name: "Paris",
      admin1: "\u00cele-de-France",
      country: "FR",
    }, {
      name: "Paris",
      admin1: "Idaho",
      country: "US",
    }]
    got = result.slice(0, 2).map(r => ({
      name: r.name,
      admin1: r.admin1,
      country: r.country,
    }))
    deepStrictEqual(got, want, JSON.stringify({
      want, got, result: result.slice(0, 5), debugOut: engine.debugOut}, null, 2)
    )

// TODO - Maybe make a balance test. Exact match vs distance vs population?
// TODO Test that distance gives us a useful factor. Probably test the Dovers of the world, a lot of them have similar populations
//     Hopefully we can balance all of the factors with the help of all of these factor tests.
// TODO Make sure I got my "lng" vs "lon" in order. I'm using both in different parts of the code. Should I be?
}

async function testPopulationFactor({engine}) {
    console.log("testPopulationFactor (TODO)")
// TODO - test that I get the desired "population factor". Probably logarithmic?
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
async function testReachability({engine, indexMetadata, outputDir}, filter, description) {
    console.log("testReachability:", description)

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
            if (skipEntry(entry, fileTokenLength, filter)) {
                continue
            }

            const query = entry.admin1 ? `${entry.name} ${entry.admin1}` : `${entry.name} ${entry.country}`

            // Go to the opposite side of the world. We should be able to find
            // it even with other places having location bias
            if (Number(entry.lon) > 0) {
              engine.map.setCenter({lat: -Number(entry.lat), lng: Number(entry.lon) - 180})
            } else {
              engine.map.setCenter({lat: -Number(entry.lat), lng: Number(entry.lon) + 180})
            }

            const result = await engine.search(query)
            const visibleResults = result.slice(0, visibleResultsSize)
            for (const x of visibleResults) {
                x.entryId = getEntryId(x)
            }
            deepStrictEqual(
                visibleResults.some(r =>
                    entry.entryId == r.entryId &&

                    // Not checking if entry.admin1 is truthy; it's optional
                    // Not checking if entry.pop is truthy; it's sometimes 0? or missing?
                    entry.name && entry.country && entry.lat && entry.lon
                ),
                true,
                JSON.stringify({
                    fromFile: file.split('/').slice(-1),
                    debugOut: engine.debugOut,
                    query,
                    result,
                    want: entry,
                }, null, 2),
            )
        }
    }
}

async function makeSetup(outputDir) {
    const map = new MockMap()
    const windowObj = {}
    const engine = new AddressTextualIndex(map, outputDir, fsFetchJson, windowObj)
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

    // Test reachability. Splitting out two problem cases.
    //
    // 1) Within the right fileTokenLength (3) - fails I think because of issues parsing out tokens
    await testReachability(realDBSetup, ({fileToken, fileTokenLength}) => fileToken.length >= fileTokenLength, "normal token length")
    // 2) Less than fileTokenLength - fails because we don't handle the requesting of such files yet.
    // TODO - if we do this, we need to shorten the mininmum amount of characters typed into the search bar before showing results?
    // unless the total length will always be more than 3, so we should just keep it as-is? So I guess it would be like, "ab " and
    // that's enough for a search. Which is fine. If there's anything, it should come up with something.
    await testReachability(realDBSetup, ({fileToken, fileTokenLength}) => fileToken.length < fileTokenLength, "shorter token length")
}

main()
.catch(e => {console.error(e)});
