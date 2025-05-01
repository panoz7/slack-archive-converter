const SlackZipArchive = require('./lib/slack-zip-archive')
const path = require('path');

async function main() {
    // Load and process the slack archive zip
    const skipFiles = false;
    const startDate = process.argv[3] ? new Date(process.argv[3]) : undefined;
    const endDate = process.argv[4] ? new Date(process.argv[4]) : undefined;

    const zipArchive = await SlackZipArchive.fromZip(process.argv[2], skipFiles, startDate, endDate);

    // Save the archive zip out to the root of this project
    await zipArchive.toZip(path.join(__dirname, 'exports'));
}

main();