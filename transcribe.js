// get private config from .env file
require('dotenv').config();

const speech = require('@google-cloud/speech'),
  { Storage } = require('@google-cloud/storage'),
  fs = require('fs'),
  ffmpeg = require('fluent-ffmpeg'),
  replacements = require('./replacements.json');

// cli args
const cmdArg = process.argv[2].split('.'),
  fileName = cmdArg[0],
  fileExt = cmdArg[1];

// directory config
const splitDir = './ffmpegSplit';
const transDir = './transcripts';

// Google config
const storageClient = new Storage({
  projectId: process.env.PROJECT_ID,
  keyFilename: process.env.SERVICE_KEY_FILE
});

const speechClient = new speech.SpeechClient({
  keyFilename: process.env.SERVICE_KEY_FILE
});

const requestConfig = {
  //encoding: 'FLAC',
  languageCode: 'en-US',
  enableAutomaticPunctuation: true
};

// helper functions
const composeTranscript = () => {
  let transcripts = fs.readdirSync(transDir);
  
  transcripts.forEach(part => {
    let str = fs.readFileSync(`${transDir}/${part}`);

    fs.appendFileSync(`${fileName}.txt`, ` ${str}`);
    console.log(`${part} parsed`);
  });

  let str = fs.readFileSync(`${fileName}.txt`, 'utf8');

  replacements.forEach(pair => {
    str = str.replace(new RegExp(pair[0], 'g'), pair[1]);
    str = str.replace(new RegExp(pair[0].charAt(0).toUpperCase() + pair[0].slice(1), 'g'), pair[1].charAt(0).toUpperCase() + pair[1].slice(1));
  });

  // reduce multispace to single
  str = str.replace(/ +(?= )/g, '');

  fs.appendFileSync(`${fileName}-TRANSCRIPT.txt`, `${str}`);
}

const cleanDir = dir => {
  let files = fs.readdirSync(dir);
  console.log(`Cleaning directory: ${dir}`);

  files.forEach(file => {
    fs.unlinkSync(`${dir}/${file}`);
  });
}

const gUpload = file => {
  console.log(`[Beginning Upload] ${file}`);

  return storageClient
    .bucket(process.env.BUCKET_NAME)
    .upload(`${splitDir}/${file}`)
    .then(() => {
      console.log(`[Upload Complete] ${file}`);
    })
    .catch(err => {
      console.log('[Storage Upload Error]', err);
      reject();
    });
}

const gDelete = file => {
  return storageClient
    .bucket(process.env.BUCKET_NAME)
    .file(file)
    .delete()
    .then(() => {
      console.log(`[Cleaning Bucket] gs://${process.env.BUCKET_NAME}/${file} deleted`);
    })
    .catch(err => {
      console.log('Error deleting from bucket: ', err);
    });
}

const gTranscribe = file => {
    let request = {
      audio: {
        uri: `gs://${process.env.BUCKET_NAME}/${file}`
      },
      config: requestConfig
    }

    return speechClient.longRunningRecognize(request)
    .then(data => {
      const operation = data[0];
      // Get a Promise representation of the final result of the job
      return operation.promise();
    })
    .then(data => {
      console.log(`Start time: ${data[1].startTime.seconds}`);
      console.log(`Last update time: ${data[1].lastUpdateTime.seconds}`);
      console.log(`[Transcript] ${file} ${data[1].progressPercent}% complete`);

      const transcription = data[0].results
        .map(result => {
        return result.alternatives[0].transcript;
      }).join(' ');

      fs.writeFileSync(`${transDir}/${file}.txt`, `${transcription}`);
    })
    .catch(err => {
      console.log(`[TRANSCRIPTION FAILED] ${file}`)
      console.log('ERROR: ', err);
    });
}

// begin processing
if (!fileName){
  console.log("ERROR: No filename given.");
}else{
  // Clean up and get ready
  console.log(`Preparing ffmpeg...`);
  cleanDir(splitDir);
  cleanDir(transDir);

  // Begin transcribing
  // ffmpeg command to split and output single-channel flac
  ffmpeg(fileName+'.'+fileExt).outputOptions([
    '-vn',
    '-f segment',
    '-segment_time 600',
    '-acodec flac',
    '-ac 1'
  ])
  .on('start', (command) => {
    console.log(`[ffmpeg] command: ${command}`);
  })
  .on('error', (err) => {
    console.log(`[ffmpeg] error: ${err.message}`);
  })
  .on('end', (stdout, stderr) => {
    console.log('[ffmpeg] finished');
    
    // Begin async cloud processing
    let files = fs.readdirSync(splitDir);
    let googlePromises = [];

    files.forEach(file => {
      let promise = new Promise((resolve, reject) => {
          gUpload(file)
          .then(() => {
            console.log(`[Transcript] Begin ${file}`);
            return gTranscribe(file);
          })
          .then(() => {
            return gDelete(file);
          })
          .then(() => {
            resolve();
          });
      });

      googlePromises.push(promise);
    });

    Promise.all(googlePromises)
    .then(() => {
      console.log('[ALL PARTIAL TRANSCRIPTS RESOLVED]');
      console.log('Composing transcript from partials...');
      composeTranscript();
      console.log('[TRANSCRIPT COMPOSED]');
      cleanDir(splitDir);
      cleanDir(transDir);
    });
  })
  .output(`${splitDir}/${fileName}%03d.flac`)
  .run();
}
