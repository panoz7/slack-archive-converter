const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

async function main() {

    // Load the zips
    const archive1 = await loadZip(process.argv[2]);
    const archive2 = await loadZip(process.argv[3]);

    // Load the archive info content
    archive1Info = JSON.parse(await archive1.file(`archive-info.json`).async('string'));
    archive2Info = JSON.parse(await archive2.file(`archive-info.json`).async('string'));

    // Get the channel names that are included in each archive
    const archive1ChannelNames = archive1Info.channels.map(channel => channel.channelName);
    const archive2ChannelNames = archive2Info.channels.map(channel => channel.channelName);
    
    // Find any that overlap both archives
    // These will need to be combined 
    const overlapChannelNames = archive1ChannelNames.filter(channelName => archive2ChannelNames.includes(channelName))
    
    for (let channelName of overlapChannelNames) {

        // Load the two logs
        const archive1Log = JSON.parse(await archive1.file(path.join('logs', `${channelName}-messages.json`)).async('string'));
        const archive2Log = JSON.parse(await archive2.file(path.join('logs', `${channelName}-messages.json`)).async('string'));

        // Combine and sort the messages by timestamp
        const combinedMessages = [...archive1Log.messages, ...archive2Log.messages].sort((a, b) => a.timeStamp - b.timeStamp);

        // Combine the replies
        const combinedReplies = [...archive1Log.replies, ...archive2Log.replies]

        // Write the combined file back to the first zip 
        const combinedLog = {
            messages: combinedMessages,
            replies: combinedReplies
        }
        archive1.file(path.join('logs', `${channelName}-messages.json`), JSON.stringify(combinedLog, null, 2));
    }

    // Get the non-overlap channel names from the second archive 
    const nonOverlapChannelNames = archive2ChannelNames.filter(channelName => !overlapChannelNames.includes(channelName))

    // Add those logs to the first zip and to the channels object in the first zip's info
    for (let channelName of nonOverlapChannelNames) {
        await transferFileFromZip(path.join('logs', `${channelName}-messages.json`), archive2, archive1)
        archive1Info.channels.push({
            channelName, 
            file: path.join('logs', `${channelName}-messages.json`)
        })
    } 

    // Copy the file download logs over to the first zip 
    await transferFolderContents('file-download-logs', archive2, archive1)

    // Copy the files themselves
    await transferFolderContents('files', archive2, archive1)

    // Copy over the original slack exports
    for (let channelName of archive2ChannelNames) {
        const folderPath = path.join('slack-export', channelName)
        await transferFolderContents(folderPath, archive2, archive1)
    }

    // Copy over the user data 
    await transferFolderContents(path.join('slack-export', 'user-data'), archive2, archive1)

    // Add the log content object from the second zip to the first's info
    archive1Info.contents = [...archive1Info.contents, ...archive2Info.contents];
    
    // Merge together the user's objects
    for (let userId in archive2Info.users) {
        archive1Info.users[userId] = archive2Info.users[userId];
    }

    // Write the updated archive1 info back to the zip
    archive1.file('archive-info.json', JSON.stringify(archive1Info, null, 2));

    // Finally get the earliest and latest dates for the archive 
    const {startDate, endDate} = getArchiveRange(archive1Info.contents);

    // Format the archive start and end dates
    const startDateFormatted = formatDateForFileName(startDate);
    const endDateFormatted = formatDateForFileName(endDate);

    const outputDir = path.join(__dirname, 'exports', 'concat')
    fs.existsSync(outputDir);

    console.log('saving zip')

    // Save the zip
    // Generate the zip file as a nodejs buffer
    archive1.generateAsync({
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

function getArchiveRange(contents) {
    let startDate;
    let endDate;
    
    for (let archiveInfo of contents) {
        let archiveStartDate = new Date(archiveInfo.startDate)
        let archiveEndDate = new Date(archiveInfo.endDate)

        if (!startDate || archiveStartDate < startDate) {
            startDate = archiveStartDate;
        }

        if (!endDate || archiveEndDate > endDate) {
            endDate = archiveEndDate;
        }
    }

    return {
        startDate,
        endDate
    } 
}

function formatDateForFileName(date) {
    const year = (date.getYear() + 1900).toString();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}${month}${day}`;
}


async function transferFileFromZip(filePath, sourceZip, destinationZip) {
    const zipFile = await sourceZip.file(filePath).async('arraybuffer');
    destinationZip.file(filePath, zipFile);
}

async function transferFolderContents(folderPath, sourceZip, destinationZip) {
    const files = [];
    sourceZip.folder(folderPath).forEach(async (fileName, file) => {
        files.push({fileName, file})
    })

    for (let file of files) {
        const fileContents = await file.file.async('arraybuffer');
        destinationZip.file(path.join(folderPath, file.fileName), fileContents)
    }
};



async function loadZip(zipPath) {
    const zipName = path.basename(zipPath, '.zip');

    // Load the zip
    const zipFile = fs.readFileSync(zipPath);
    const zip = await JSZip.loadAsync(zipFile);

    return zip;
}

  
main();