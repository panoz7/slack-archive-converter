const SlackZipArchive = require('./lib/slack-zip-archive')
const path = require('path');

async function main() {
    // Load and process the slack archive zip
    const skipFiles = false;
    const zipArchive = await SlackZipArchive.fromZip(process.argv[2], skipFiles);

    // Save the archive zip out to the root of this project
    await zipArchive.toZip(path.join(__dirname, 'exports'));
}

main();