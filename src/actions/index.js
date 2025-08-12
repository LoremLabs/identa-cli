// local actions

import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const extractShellDescription = async (filepath) => {
  try {
    const content = await fs.readFile(filepath, 'utf8');
    const lines = content.split('\n');

    for (let i = 1; i < lines.length; i++) {
      let line = lines[i].trim();
      if (line.startsWith('# description')) {
        line = line.replace(/^# description\s*/, ''); // strip leading "# description"

        line = line.replace(/#.*$/, ''); // strip trailing comments
        line = line.trim(); // trim whitespace
        // remove quotes at the start and end via regex
        line = line.replace(/^['"]/, '').replace(/['"]$/, '');
        line = line.replace(/['"]$/, ''); // strip trailing quotes
        return line;
      }
      if (line !== '') break; // stop at first non-comment line
    }
  } catch (err) {
    // ignore error and return nothing
  }

  return '';
};

export async function loadActions() {
  const actionsDir = __dirname; // path.join(__dirname, "actions");
  const files = await fs.readdir(actionsDir);
  const actions = {};

  const seen = new Set();

  for (const file of files) {
    // skip for index.js
    if (file === 'index.js') {
      continue;
    }
    // skip for hidden files
    if (file.startsWith('.')) {
      continue;
    }

    const ext = path.extname(file);
    const base = path.basename(file, ext);

    if (seen.has(base)) {
      continue; // already handled (JS takes priority)
    }
    seen.add(base);

    const fullPath = path.join(actionsDir, file);

    if (ext === '.js') {
      const mod = await import(fullPath);
      if (typeof mod.exec === 'function') {
        actions[base] = mod;
      }
    } else if (ext === '.sh') {
      // fallback: create an exec wrapper that runs the shell script
      const description = await extractShellDescription(fullPath);

      actions[base] = {
        description,
        exec: async (context) => {
          const { spawn } = await import('child_process');
          return new Promise((resolve, reject) => {
            const proc = spawn('bash', [fullPath, ...context.input], {
              stdio: 'inherit',

              env: {
                ...process.env,
                ...context.flags, // --this=that
              },
            });

            proc.on('exit', (code) => {
              code === 0 ? resolve() : reject(new Error(`Script failed: ${code}`));
            });
          });
        },
      };
    }
  }

  return actions;
}
