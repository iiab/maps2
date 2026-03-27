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
import * as fs from "fs"
import * as zlib from "zlib"

// we'll be doing so many file reads, and the files are so small - we may as well cache all of it
// fileCache[path] = contents
const fileCache = {}

// Number of visible results when searching for something. We generally
// want to make sure that what we're looking for is visible.
const visibleResultsSize = 5

// Pretend to fetch a json/gz file from the server. Instead just find the
// corresponding file in the file system. Also cache every file we read.
const fsFetchJson = path => new Promise((resolve, reject) => {
    // read from cache instead
    if (fileCache[path]) {
        resolve(fileCache[path])
        return
    }

    // Fake 200-ish response
    const found = text => {
        fileCache[path] = {
            json: () => {
                return JSON.parse(text)
            },
            ok: true,
        }
        resolve(fileCache[path])
    }

    // Fake 404 response
    const notFound = () => {
        fileCache[path] = {ok: false}
        resolve(fileCache[path])
    }

    // console.log("reading", path)

    // First look for the *.json file
    fs.readFile(path, (err, data) => {
        if (!err) {
            // *.json file found
            found(data.toString())
        } else if (err.code === 'ENOENT') {
            // *.json file not found, lets look for the *.json.gz file
            fs.readFile(path + '.gz', (err, compressedData) => {
                if (!err) {
                    // *.json.gz file found
                    const decompressedData = zlib.gunzipSync(compressedData);
                    found(decompressedData.toString())
                } else if (err.code === 'ENOENT') {
                    // *.json.gz file not found
                    notFound()
                } else {
                    // Some other error
                    reject(err)
                }
            })
        } else {
            // Some other error
            reject(err)
        }
    })
})

// list all of the files in the search index
function* listIndexFiles(outputDir) {
    const files = fs.readdirSync(outputDir)
    for (const file of files) {
        // strip the .gz since we don't request that part explicitly
        const jsonFName = file.split('.gz')[0]
        if (jsonFName === "index_metadata.json") continue;
        yield `${outputDir}/${jsonFName}`
    }
}

// wrap search such that it returns [] instead of throwing an exception
async function search(engine, term) {
    try {
        return await engine.search(term)
    } catch (e) {
        const errStr = 'Error: Query string insufficient for the search'
        if (e.toString().split('\n')[0] !== errStr) {
            throw e
        }
        return []
    }
}

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
                       .replace(/^[^\p{L}]+/u, '')
                       .split(/[^\p{L}]+/u)[0]

    if (!filter({fileToken, fileTokenLength})) {
        // console.log('no', fileToken, fileToken.length, entry['name'])
        return true
    }

    // console.log('yes', fileToken, fileToken.length, entry)
    return false
}

async function testBasic({engine}) {
    let result

    console.log("testBasic")
    result = await engine.search("New York")
    deepStrictEqual(result[0]["name"], "New York City")

    // City name alone (no state or country) still works if it happens to be the best match
    result = await engine.search("Chicago")
    deepStrictEqual({
      name: result[0]["name"],
      admin1: result[0]["admin1"],
      country: result[0]["country"],
    }, {
      name: "Chicago",
      admin1: "Illinois",
      country: "US",
    })

    deepStrictEqual((await engine.search("ZZZ")).length, 0)
}

// Test that every name in the search index that passes `filter` is searchable
// with our current engine.
async function testReachability({engine, indexMetadata, outputDir}, filter, description) {
    console.log("testReachability:", description)

    // Get the token length from the metadata file within the database
    const fileTokenLength = Number(indexMetadata['token_length'])

    for (const file of listIndexFiles(outputDir)) {
        const fileEntries = await (await fsFetchJson(file)).json()

        // console.log(`reachability: looking for ${fileEntries.length} entries in ${file}`)
        for (const entry of fileEntries) {
            if (skipEntry(entry, fileTokenLength, filter)) {
                continue
            }
            const result = await search(engine, entry['name'])
            const visibleResults = result.slice(0, visibleResultsSize)
            deepStrictEqual(
                visibleResults.some(r =>
                    entry.name && entry.name === r.name &&
                    entry.pop && entry.pop === r.pop &&
                    entry.lat && entry.lat === r.lat &&
                    entry.lon && entry.lon === r.lon
                ),
                true,
                `Cannot find "${entry.name}" (from ${file.split('/').slice(-1)}) in ${engine.currentFileToken}.json: ` + JSON.stringify(result.map(a => a.name)),
            )
        }
    }
}

async function main() {
    const outputDir = "../output"
    const debug = {}
    const engine = new AddressTextualIndex({}, outputDir, fsFetchJson, {}, debug)
    const indexMetadata = await (await fsFetchJson(`${outputDir}/index_metadata.json`)).json()
    const testSetup = {outputDir, engine, indexMetadata}

    await testBasic(testSetup)

    // Test reachability. Splitting out two problem cases.
    //
    // 1) Within the right fileTokenLength (3) - fails I think because of issues parsing out tokens
    await testReachability(testSetup, ({fileToken, fileTokenLength}) => fileToken.length >= fileTokenLength, "normal token length")
    // 2) Less than fileTokenLength - fails because we don't handle the requesting of such files yet.
    await testReachability(testSetup, ({fileToken, fileTokenLength}) => fileToken.length < fileTokenLength, "shorter token length")
}

main()
.catch(e => {console.error(e)});
