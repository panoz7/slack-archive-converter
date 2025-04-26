const path = require('path');
const https = require('https');
const crypto = require('crypto');

class SlackChannel {

    parentArchive;
    channelName;
    zipTranscriptFiles = [];
    messages = [];
    replies = [];
    fileUrls = [];
    files = [];
    skipFiles = false;

    constructor(parentArchive, channelName, skipFiles) {
        this.parentArchive = parentArchive;
        this.channelName = channelName;
        this.skipFiles = skipFiles;
    }

    async process() {

        // Load the jszip transcript file entries for the channel
        this.parentArchive.zip.folder(path.join(this.parentArchive.zipName, this.channelName)).forEach((fileName, file) => {
            this.zipTranscriptFiles.push({fileName, file})
        })

        // Extract and format the messages 
        for (let zipTranscriptFile of this.zipTranscriptFiles) {
            
            // Load the transcript content and add it to the file entry
            const transcriptFileContent = await (zipTranscriptFile.file.async('string'));
            zipTranscriptFile.content = transcriptFileContent;

            const transcriptJson = JSON.parse(transcriptFileContent)

            // Process the messages and add them to the messages array
            const formattedMessages = transcriptJson.map(this.mapEntry, this)
            this.messages.push(...formattedMessages);
        
            // Grab any files and add their private urls to the fileUrls array
            for (let message of transcriptJson) {
                if (message.files) {
                    this.fileUrls.push(...message.files.map(fileData => fileData.url_private))
                }
            }
        }

        // Filter out messages that don't have timestamps and then sort by timestamp
        this.messages = this.messages
            .filter(message => message.timeStamp)
            .sort((a,b) => a.timeStamp - b.timeStamp);

        // Grab out any messages that are replies 
        const replyTimeStamps = this.messages.reduce((acc,cur) => [...acc, ...cur.replies || []] , [])

        // Go through them and pull any replies into a seperate replies array 
        this.replies = replyTimeStamps.map(replyTimeStamp => {

            // Get the index of the reply 
            const replyIndex = this.messages.findIndex(message => message.timeStamp == replyTimeStamp);

            if (replyIndex) {
                return this.messages.splice(replyIndex, 1)[0];
            }

            return {
                date: null,
                timeStamp: replyTimeStamp,
                userId: "unknown",
                displayName: "unknown",
                text: "Unable to find this reply",
            }
        })


        // Download the files 
        if (!this.skipFiles) {
            this.files = await Promise.all(this.fileUrls.map(this.downloadFile, this))
        }
        

        

    }

    toZip(outputZip) {
        // Add the messages and replies
        const messages = {
            messages: this.messages,
            replies: this.replies
        }
        outputZip.file(path.join('logs', `${this.channelName}-messages.json`), JSON.stringify(messages, null, 2));

        // Add the original export transcripts
        for (let zipTranscriptFile of this.zipTranscriptFiles) {
            outputZip.file(path.join('slack-export', this.channelName, zipTranscriptFile.fileName), zipTranscriptFile.content);
        }

        let fileDownloadLog = [];
        // Add the downloaded files
        for (let file of this.files) {

            // Remove the token from the end
            const noTokenUrl = file.url.substring(0, file.url.indexOf('?'))

            // Split it by slashes and grab out the ID and image name
            const [imageId, imageName] = noTokenUrl.split('/').slice(4,6);

            // We'll use those to build the file name for the downloaded image
            const downloadName = `${imageId}-${imageName}`

            // Add the file to the zip
            outputZip.file(path.join('files', downloadName), file.buffer);

            // Add the file details to the log
            fileDownloadLog.push({
                fileName: downloadName,
                sourceUrl: file.url,
                sha256: file.sha256,
                downloadTime: file.downloadTime
            })

        }


        // Add the download log
        outputZip.file(this.getFileDownloadLogPath(), JSON.stringify(fileDownloadLog, null, 2));

    } 

    getFileDownloadLogPath() {
        const startDateFormatted = this.parentArchive.formatDateForFileName(this.parentArchive.exportStartDate)
        const endDateFormatted = this.parentArchive.formatDateForFileName(this.parentArchive.exportEndDate)

        return path.join('file-download-logs', `${this.channelName}-${startDateFormatted}-${endDateFormatted}.json`);
    }

    mapEntry(message) {
        try {
            return {
                date: new Date(message.ts * 1000),
                timeStamp: message.ts,
                userId: message.user,
                displayName: this.parentArchive.getNameByUserById(message.user),
                text: this.cleanMessageText(message.text),
                files: message.files?.map(this.genFileObject, this),
                replies: message.replies?.map(reply => reply.ts)
            }    
        } catch(e) {
            console.log(e, message)
        }

    }

    genFileObject(file) {
        const fileName = this.getDownloadName(file.url_private)
    
        return {
            fileName,
            fileType: file.filetype
        }
    }
    
    getDownloadName(url) {
            // Remove the token from the end
            const noTokenUrl = url.substring(0, url.indexOf('?'))
    
            // Split it by slashes and grab out the ID and image name
            const [imageId, imageName] = noTokenUrl.split('/').slice(4,6);
    
            // We'll use those to build the file name for the downloaded image
            return `${imageId}-${imageName}`
    }

    cleanMessageText(text) {

        try {
            let cleanedText;
        
            // Swap any @mentions with the user's display name
            const atUserRegex = /<@U\w{10}>/g
            cleanedText = text.replaceAll(atUserRegex, atMentionId => `<span class="at-mention">@${this.parentArchive.getNameByAtMentionId(atMentionId)}</span>`);
        
            // Swap any <!channel>s with @channel
            const atChannelRegex = /<!channel>/g
            cleanedText = cleanedText.replaceAll(atChannelRegex, `<span class="at-mention">@channel</span>`);
        
            // Replace any URL tags with a tags
            const urlRegex = /<https:\/\/.*?>/g
            cleanedText = cleanedText.replaceAll(urlRegex, urlTag => {
                const url = urlTag.substring(1, urlTag.length - 1);
                return `<a href="${url}" target="_blank">${url}</a>`;
            });
        
            // Replace any mailto tags with a tags
            const mailToRegex = /<mailto:.*?><\/mailto:.*?>/g
            cleanedText = cleanedText.replaceAll(mailToRegex, mailtoTag => {
                // grab just the email address from the tag
                const emailRegex = /<mailto:(.*?)\|/
                const email = mailtoTag.match(emailRegex)[1];
        
                return `<a href="mailto:${email}">${email}</a>`;
            });
        
            // Replace any tel tags with the phone number
            const telRegex = /<tel:.*?>/g
            cleanedText = cleanedText.replaceAll(telRegex, telTag => {
        
                // grab just the phone number from the tag
                const phoneRegex = /<tel:(.*?)\|/
                const phoneNum = telTag.match(phoneRegex)[1];
        
                return `${phoneNum}`;
            });
        
            // Replace any new lines with brs 
            const newLineRegex = /\n/g
            cleanedText = cleanedText.replaceAll(newLineRegex, "<br/>")
        
            return cleanedText

        } catch(e) {
            return text;
        }
    
    }

    async downloadFile(url) {

        return new Promise((resolve, reject) => {
            const data = [];
            const hash = crypto.createHash('sha256');
    
            https.get(url, response => {
    
                response.on('data', (chunk) => {
                    hash.update(chunk); 
                    data.push(chunk);
                  });
    
                response.on('end', () => {
                    const sha256 = hash.digest('hex'); 
                    console.log(`Downloaded: ${url}`);
                    console.log(`Hash: ${sha256}`);
                    resolve({
                        url,
                        buffer: Buffer.concat(data),
                        sha256,
                        downloadTime: new Date()
                    });
                  });
    
            })
        })
    }

    static async fromJsZip(parentArchive, channelName, skipFiles) {

        const slackChannel = new SlackChannel(parentArchive, channelName, skipFiles);
        await slackChannel.process();

        return slackChannel;

    }


}

module.exports = SlackChannel