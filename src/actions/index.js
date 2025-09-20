// local actions

import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';

export const ACTIONS_MANIFEST = {
  // Core authentication and configuration
  auth: () => import('./auth.js'),
  config: () => import('./config.js'),

  // Fragment management
  fragment: () => import('./fragment.js'),

  // Key management
  keys: () => import('./keys.js'),

  // Secrets management
  secrets: () => import('./secrets.js'),

  // Testing and debugging
  'test-sdk': () => import('./test-sdk.js'),
  ok: () => import('./ok.js'),
};

const isBun = typeof globalThis.Bun !== 'undefined' || !!process.versions?.bun;
const isPkg = !!process.pkg; // for other single-file bundlers
const isBundled = isBun || isPkg;

// ESM-friendly __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

/**
 * Node/dev loader — discovers actions from filesystem
 */
async function loadFromFilesystem(actionsDir = __dirname) {
  const files = await fs.readdir(actionsDir);
  const actions = {};
  const seen = new Set();

  for (const file of files) {
    // Skip self/infra files
    if (file === 'index.js' || file === 'load-actions.js' || file === 'manifest.js') continue;
    if (file.startsWith('.')) continue;

    const ext = path.extname(file);
    const base = path.basename(file, ext);
    if (seen.has(base)) continue;
    seen.add(base);

    const fullPath = path.join(actionsDir, file);

    if (ext === '.js') {
      const url = pathToFileURL(fullPath).href;
      const mod = await import(url);
      if (typeof mod.exec === 'function') {
        actions[base] = mod;
      }
    } else if (ext === '.sh') {
      // Optional shell fallback
      const description = await extractShellDescription(fullPath);
      actions[base] = {
        description,
        exec: async (context) => {
          const { spawn } = await import('node:child_process');
          await new Promise((resolve, reject) => {
            const proc = spawn('bash', [fullPath, ...(context?.input ?? [])], {
              stdio: 'inherit',
              env: { ...process.env, ...(context?.flags ?? {}) },
            });
            proc.on('exit', (code) =>
              code === 0 ? resolve() : reject(new Error(`Script failed: ${code}`))
            );
          });
        },
      };
    }
  }

  return actions;
}

/**
 * Bundled loader — uses explicit manifest of lazy imports
 * Preserves lazy-loading by exposing exec via thunks.
 */
async function loadFromManifest() {
  const actions = {};

  for (const [name, load] of Object.entries(ACTIONS_MANIFEST)) {
    // We expose a proxy module that only imports when .exec() is called
    actions[name] = {
      // optional: description could be a static string here if you want
      // description: '…',

      exec: async (...args) => {
        const mod = await load(); // dynamic import
        if (typeof mod.exec !== 'function') {
          throw new Error(`Action "${name}" has no exported exec()`);
        }
        return mod.exec(...args);
      },
    };
  }

  return actions;
}

/**
 * Public API: dual-mode action loader
 */
export async function loadActions() {
  // Use FS discovery in dev/Node, manifest in bundled environments.
  if (!isBundled) {
    try {
      return await loadFromFilesystem(path.join(__dirname));
    } catch (err) {
      // If fs fails for any reason (permissions/etc.), fall back
      // (this also helps when running inside restricted envs)
      return await loadFromManifest();
    }
  } else {
    return await loadFromManifest();
  }
}

// export async function loadActions() {
//   const actionsDir = __dirname; // path.join(__dirname, "actions");
//   const files = await fs.readdir(actionsDir);
//   const actions = {};

//   const seen = new Set();

//   for (const file of files) {
//     // skip for index.js
//     if (file === 'index.js') {
//       continue;
//     }
//     // skip for hidden files
//     if (file.startsWith('.')) {
//       continue;
//     }

//     const ext = path.extname(file);
//     const base = path.basename(file, ext);

//     if (seen.has(base)) {
//       continue; // already handled (JS takes priority)
//     }
//     seen.add(base);

//     const fullPath = path.join(actionsDir, file);

//     if (ext === '.js') {
//       const mod = await import(fullPath);
//       if (typeof mod.exec === 'function') {
//         actions[base] = mod;
//       }
//     } else if (ext === '.sh') {
//       // fallback: create an exec wrapper that runs the shell script
//       const description = await extractShellDescription(fullPath);

//       actions[base] = {
//         description,
//         exec: async (context) => {
//           const { spawn } = await import('child_process');
//           return new Promise((resolve, reject) => {
//             const proc = spawn('bash', [fullPath, ...context.input], {
//               stdio: 'inherit',

//               env: {
//                 ...process.env,
//                 ...context.flags, // --this=that
//               },
//             });

//             proc.on('exit', (code) => {
//               code === 0 ? resolve() : reject(new Error(`Script failed: ${code}`));
//             });
//           });
//         },
//       };
//     }
//   }

//   return actions;
// }
