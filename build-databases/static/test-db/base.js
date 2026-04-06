import * as fs from "fs"
import * as zlib from "zlib"

////////////
//   Fetch
////////////

// we'll be doing so many file reads, and the files are so small - we may as well cache all of it
// fileCache[path] = contents
const fileCache = {}

// Pretend to fetch a json/gz file from the server. Instead just find the
// corresponding file in the file system. Also cache every file we read.
export const fsFetchJson = path => new Promise((resolve, reject) => {
    // read from cache instead
    if (fileCache[path]) {
        resolve(fileCache[path])
        return
    }

    // TODO debug.fileSystem
    // console.log(`Getting ${path} from the file system`)

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
export function* listIndexFiles(outputDir) {
    const files = fs.readdirSync(outputDir)
    for (const file of files) {
        // strip the .gz since we don't request that part explicitly
        const jsonFName = file.split('.gz')[0]
        if (jsonFName === "index_metadata.json") continue;
        yield `${outputDir}/${jsonFName}`
    }
}

////////////
//   Map
////////////

export class MockMap {
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

