const { spawn } = require('child_process');

// Spawn script1.js
const script1 = spawn('node', ['alert.js']);
script1.stdout.on('data', (data) => console.log(`Script1 Output: ${data}`));
script1.stderr.on('data', (data) => console.error(`Script1 Error: ${data}`));
script1.on('close', (code) => console.log(`Script1 exited with code ${code}`));

// Spawn script2.js
const script2 = spawn('node', ['app.js']);
script2.stdout.on('data', (data) => console.log(`Script2 Output: ${data}`));
script2.stderr.on('data', (data) => console.error(`Script2 Error: ${data}`));
script2.on('close', (code) => console.log(`Script2 exited with code ${code}`));


const script3 = spawn('node', ['bot.js']);
script3.stdout.on('data', (data) => console.log(`bot Output: ${data}`));
script3.stderr.on('data', (data) => console.error(`bot Error: ${data}`));
script3.on('close', (code) => console.log(`bot exited with code ${code}`));


const script4 = spawn('node', ['bsc.js']);
script4.stdout.on('data', (data) => console.log(`bsc Output: ${data}`));
script4.stderr.on('data', (data) => console.error(`bsc Error: ${data}`));
script4.on('close', (code) => console.log(`bsc exited with code ${code}`));




