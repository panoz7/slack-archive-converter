const SlackZipArchive = require('./lib/slack-zip-archive')

async function main() {
    // Load and process the slack archive zip
    const zipArchive = await SlackZipArchive.fromZip(process.argv[2], false);

    // Save the archive zip out to the root of this project
    await zipArchive.toZip(__dirname);
}

main();