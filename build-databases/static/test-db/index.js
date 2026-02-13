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

import { deepEqual } from 'assert';
import { AddressTextualIndex } from "./static_search.js";
import * as fs from "fs"
import * as zlib from "zlib"

// we'll be doing so many file reads, and the files are so small - we may as well cache all of it
const fileCache = {}

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

async function main() {
  const engine = new AddressTextualIndex({}, "../output", fsFetchJson, {})

  const result = await engine.search("New York")
  deepEqual(result[0]["name"], "New York City")

  deepEqual((await engine.search("ZZZ")).length, 0)
}

main()
.catch(e => {console.error(e)});
