const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const SlackChannel = require('./slack-channel')

class SlackZipArchive {

    zipName;
    zip;
    skipFiles = false;
    userDataFile;
    userData;
    exportStartDate;
    exportEndDate;
    contents = [];
    channels = [];
    archiveInfo;
    isProcessedArchive = false;

    constructor(zipName, jsZipObj, skipFiles) {
        this.zipName = zipName;
        this.zip = jsZipObj;
        this.skipFiles = skipFiles;
    }

    async process() {

        console.log(`Processing ${this.zipName}`)

        // Get the start and end dates of the export
        const dateRange = this.getSlackExportRange();
        this.exportStartDate = dateRange.startDate;
        this.exportEndDate = dateRange.endDate;

        // Load the users file
        this.userDataFile = await this.zip.file('users.json').async('string');
        this.userData = this.processUserData(this.userDataFile);

        // Iterate through the root folders in the zip (these correspond to each of the channels)
        // and extract the channel names from them 
        let channelNames = Object.keys(this.zip.files).filter(fileName => {
            const fileDetails = this.zip.files[fileName]
            return fileDetails.dir && fileName != `${this.zipName}/`
        }).map(folderName => folderName.split('/')[0])
            // .filter(channelName => ['1933', '1941'].includes(channelName))

        // Process each channel
        this.channels = await Promise.all(
            channelNames.map(async (channelName) => await SlackChannel.fromJsZip(this, channelName, this.skipFiles))
        )
    
        // Add the record to the contents array
        this.contents.push({
            startDate: dateRange.startDate,
            endDate: dateRange.endDate,
            generationDate: new Date(),
            skipFiles: this.skipFiles
        })

    
    }

    getNameByUserById(userId) {
        return this.userData.get(userId) || userId;
    }
    
    getNameByAtMentionId(atMentionId) {
        // grab just the userID by removing the first two and last characters
        const userId = atMentionId.substring(2, atMentionId.length - 1);
        return this.getNameByUserById(userId)
    }

    processUserData(userDataFile) {
        const userData = new Map();
        const userDataJson = JSON.parse(userDataFile);

        for (let user of userDataJson) {
            userData.set(user.id, user.profile.real_name)
        }

        return userData;
        
    }

    async toZip(outputDir) {

        // Create the output zip
        const outputZip = new JSZip();

        // Format the archive start and end dates
        // These will be used for the user data file and the overall zip name
        const startDateFormatted = this.formatDateForFileName(this.exportStartDate)
        const endDateFormatted = this.formatDateForFileName(this.exportEndDate)

        // Add the original users.json file
        outputZip.file(path.join('slack-export', 'user-data', `user-${startDateFormatted}-${endDateFormatted}.json`), this.userDataFile);


        // Add the archive-info.json file
        const infoData = {
            contents: this.contents, 
            channels: this.channels.map(channel => {return {
                channelName: channel.channelName,
                file: path.join('logs', `${channel.channelName}-messages.json`)
            }}), 
            users: Object.fromEntries(this.userData)
        }

        // Have each channel add its content
        for (let channel of this.channels) {
            channel.toZip(outputZip);
        }

        outputZip.file('archive-info.json', JSON.stringify(infoData, null, 2));

        // Save the zip
        console.log('generating zip')

        // Make sure the output archive exists
        fs.existsSync(outputDir);


        // Generate the zip file as a nodejs buffer
        outputZip.generateAsync({
            type: 'nodebuffer',
            compression: 'DEFLATE', // Use compression
            compressionOptions: {
            level: 9 // Best compression
            }
        })
        .then(function(content) {
            // Write the content to a file
            const outputPath = path.join(outputDir, `slack-archive-${startDateFormatted}-${endDateFormatted}.zip`);
            fs.writeFileSync(outputPath, content);
            console.log(`Zip file created at: ${outputPath}`);
        })

    }

    getSlackExportRange() {

        const dateRegEx = /[A-Z][a-z][a-z] \d{1,2} 20\d{2}/g
        const [startDateString, endDateString] = this.zipName.match(dateRegEx)

        return {
            startDate: new Date(startDateString),
            endDate: new Date(endDateString)
        }


    }

    formatDateForFileName(date) {
        const year = (date.getYear() + 1900).toString();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        return `${year}${month}${day}`;
    }

    static async fromZip(zipPath, skipFiles) {
        const zipName = path.basename(zipPath, '.zip');

        // Load the zip
        const zipFile = fs.readFileSync(zipPath);
        const zip = await JSZip.loadAsync(zipFile);

        const zipArchive = new SlackZipArchive(zipName, zip, skipFiles);
        await zipArchive.process();

        return zipArchive;
    }
}

module.exports = SlackZipArchive;