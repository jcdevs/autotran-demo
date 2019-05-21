# autotran-demo
This tool leverages Google's speech-to-text and storage APIs along with the external dependency FFmpeg to produce a transcription of any audio or video file.

## Set up
- Must download and install FFmpeg from https://ffmpeg.org/ for the node library fluent-ffmpeg that this tool uses.
- Enable the storage and speech-to-text APIs in your Google Cloud Platform project, download your private service key file, and populate the variables in .env with your project settings
- Place any audio or video file in the tool's root directory, and execute `node transcribe <FILE NAME>.<FILE EXTENSION>`
