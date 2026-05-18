
import * as fs from 'fs';
const content = fs.readFileSync('src/App.tsx', 'utf-8');
const lines = content.split('\n');
let inString = false;
let quoteChar = '';
for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (let j = 0; j < line.length; j++) {
        const char = line[j];
        if ((char === '"' || char === "'") && (j === 0 || line[j-1] !== '\\')) {
            if (!inString) {
                inString = true;
                quoteChar = char;
            } else if (char === quoteChar) {
                inString = false;
            }
        }
    }
    if (inString && i < 1550) { //translations end around 1543
        console.log(`Potential issue at line ${i+1}: ${line}`);
    }
}
