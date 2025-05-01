# Slack Archive Converter
A node based tool which takes a slack export zip and converts it into an archive zip. An archive zip contains the following: 
- The original transcript files from the slack export.
- The original user data file form the slack export.
- All files that were referenced as attachments in the export.
- Log files that track the attachment's original URLs, when they were downloaded, and a SHA256 hash of the downloaded file. The log files are divided by channel. 
- Transcript files for each channel which take the original transcript content and extract the information needed to generate a PDF transcript. 
- A `archive-info.json` file which has metadata about the archive.

## Commands
The tool has two main commands: 
- [Process](#process) - Converts a slack export zip into an archive zip
- [Concat](#concat) - Combines two archive zips into a single new zip 

### Process
`npm run process {path to slack export zip} {startDate} {endDate}`
The process command takes a slack export zip and converts it into an archive. Depending on the number of attachments this command could take a while to run. The startDate and endDate arguments are optional, though if you use one you need to use both. They can be used when the resulting archive would be too large to use. 

The resulting archive zips will be placed in a "export" folder within this project with the name slack-archive-YYYYMMDD-YYYYMMDD. The dates are the start and end date for the original slack export (which doesn't neccessarily match the start and end date of the actual messages). 

### Concat
`npm run concat {path to first slack archive} {path to second slack archive}`
The concat command takes two slack archives and combines them into one new archive, retaining all the original files and logs, but merging the transcript files. 

The original archive zips will be retained. The combined archive zip will be placed in a "export/concat" folder within this project with the name slack-archive-YYYYMMDD-YYYYMMDD. The start date is the earliest date of the two source archives and the end date is the latest end date of the two archives. 

## Workflow

1. Download slack archives monthly. 
2. Run the process command to create a archive zip. 
3. Run the concat command to combine the new archive with any previous archive's from the same year. 
4. Upload the monthly archive zip. 
5. Upload the new ytd archive zip and delete the previous one.  