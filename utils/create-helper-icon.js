const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const source = path.join(root, 'src', 'assets', 'img', 'icon128.png');
const output = path.join(__dirname, 'helper-icon.ico');

if (!fs.existsSync(source)) {
  throw new Error(`Missing helper icon source: ${source}`);
}

const png = fs.readFileSync(source);
const header = Buffer.alloc(6);
const directory = Buffer.alloc(16);

header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);

directory[0] = 128;
directory[1] = 128;
directory[2] = 0;
directory[3] = 0;
directory.writeUInt16LE(1, 4);
directory.writeUInt16LE(32, 6);
directory.writeUInt32LE(png.length, 8);
directory.writeUInt32LE(22, 12);

fs.writeFileSync(output, Buffer.concat([header, directory, png]));
console.log(`Created ${output}`);
