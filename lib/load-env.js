const fs = require('fs');
const dotenv = require('dotenv');

const sharedPath = '/opt/systemk-config/shared.env';
const initialKeys = new Set(Object.keys(process.env));

function loadFile(file, local) {
  if (!fs.existsSync(file)) return;
  const values = dotenv.parse(fs.readFileSync(file));
  for (const [name, value] of Object.entries(values)) {
    if (!initialKeys.has(name) && (local || process.env[name] === undefined)) process.env[name] = value;
  }
}

module.exports = function loadEnvironment() {
  loadFile(sharedPath, false);
  loadFile(`${__dirname}/../.env`, true);
  loadFile(`${__dirname}/../.env.mail`, true);
};
