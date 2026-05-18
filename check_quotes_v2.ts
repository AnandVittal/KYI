
import * as fs from 'fs';
const content = fs.readFileSync('src/App.tsx', 'utf-8');
const lines = content.split('\n');
let inString = false;
let quoteChar = '';
for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (let j = 0; j < line.length; j++) {
        const char = line[j];
        if ((char === '"' || char === "'" || char === "`") && (j === 0 || line[j-1] !== '\\')) {
            if (!inString) {
                inString = true;
                quoteChar = char;
            } else if (char === quoteChar) {
                inString = false;
            }
        }
    }
    // Only report if we end a line still in a string that was NOT a template literal
    // (since template literals can span multiple lines)
    if (inString && quoteChar !== '`') {
        console.log(`Unclosed ${quoteChar} at end of line ${i+1}: ${line}`);
        // Reset state to avoid cascading errors for simple quotes
        inString = false;
    }
}
