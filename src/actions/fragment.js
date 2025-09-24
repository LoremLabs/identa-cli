import { decodeBase64Url } from '../lib/bytes.js';

import { IdentClient } from '@ident-agency/core';
import chalk from 'chalk';
import config from '../lib/config.js';
import { createDeviceKeyStorageProvider } from '../lib/device-key-storage.js';
import fs from 'fs';
import { getSecretProvider } from '../lib/secrets.js';
import os from 'os';
import path from 'path';
import prompts from 'prompts';
import { resolveApiBaseUrl } from '../lib/api-url.js';

// Create a device key provider function for CLI
function createDeviceKeyProvider() {
  return async (keyIdOrDeviceId) => {
    const secrets = await getSecretProvider();
    const service = 'ident-agency-cli';

    // Try to get device key using the full keyId first (new format)
    // Format: "device:xxx-xxx:timestamp"
    let key = `device-key-${keyIdOrDeviceId}`;
    let deviceKeyB64 = await secrets.get(service, key);

    if (!deviceKeyB64) {
      throw new Error(`Device key not found for: ${keyIdOrDeviceId}`);
    }

    console.log(
      chalk.blue(
        `🔐 Using device key from secure storage (${secrets.type()}): ${key} ${deviceKeyB64}`
      )
    );

    return Buffer.from(decodeBase64Url(deviceKeyB64));
  };
}

// Create an SSH key provider function for CLI
function createSSHKeyProvider(customKeyPath) {
  return async () => {
    const defaultKeyPath = path.join(os.homedir(), '.ssh', 'id_ed25519');
    const rsaKeyPath = path.join(os.homedir(), '.ssh', 'id_rsa');

    let keyPath;

    // If custom key path provided via flag, use it
    if (customKeyPath) {
      // Expand ~ to home directory if present
      keyPath = customKeyPath.replace(/^~/, os.homedir());

      if (!fs.existsSync(keyPath)) {
        console.error(chalk.red(`❌ SSH key not found at: ${keyPath}`));
        // Fall back to prompting
        const response = await prompts({
          type: 'text',
          name: 'keyPath',
          message: 'Enter path to SSH private key:',
          initial: defaultKeyPath,
        });
        if (!response.keyPath) {
          throw new Error('SSH key path is required');
        }
        keyPath = response.keyPath.replace(/^~/, os.homedir());
      }
    } else {
      // Try default locations
      keyPath = defaultKeyPath;
      if (!fs.existsSync(keyPath)) {
        if (fs.existsSync(rsaKeyPath)) {
          keyPath = rsaKeyPath;
        } else {
          // Prompt for custom path
          console.log(chalk.yellow('⚠️  Default SSH keys not found (id_ed25519 or id_rsa)'));
          const response = await prompts({
            type: 'text',
            name: 'keyPath',
            message: 'Enter path to SSH private key:',
            initial: defaultKeyPath,
          });
          if (!response.keyPath) {
            throw new Error('SSH key path is required');
          }
          keyPath = response.keyPath.replace(/^~/, os.homedir());
        }
      }
    }

    // Verify the key exists before trying to read it
    if (!fs.existsSync(keyPath)) {
      throw new Error(`SSH key not found at: ${keyPath}`);
    }

    const privateKey = fs.readFileSync(keyPath, 'utf8');

    let passphrase;
    if (privateKey.includes('ENCRYPTED')) {
      const response = await prompts({
        type: 'password',
        name: 'passphrase',
        message: `Enter passphrase for SSH key (${path.basename(keyPath)}):`,
      });
      passphrase = response.passphrase;
    }

    return { privateKey, passphrase };
  };
}

// Helper function to extract fragment visibility (copied from web example)
function getFragmentVisibility(fragment) {
  // Check enc property first
  if (fragment.enc) {
    return fragment.enc.alg === 'none' ? 'public' : 'private';
  }

  // Check meta flags
  if (fragment.meta?.flags?.public !== undefined) {
    return fragment.meta.flags.public ? 'public' : 'private';
  }

  // Check direct visibility property
  if (fragment.visibility) {
    return fragment.visibility;
  }

  return 'unknown';
}

export const description = 'Manage fragments (get, put, list, delete)';

export const exec = async (context) => {
  const [, subcommand, path, ...rest] = context.input;
  const value = rest.join(' ');

  if (context.flags.debug) {
    console.log(chalk.blue(`Running fragment command: ${subcommand} ${path} ${value}`));
  }

  // Create password provider for keychain operations
  const passwordProvider = {
    async getPassword(promptText) {
      // First password entry
      const response = await prompts(
        {
          type: 'password',
          name: 'password',
          message: promptText,
          validate: (value) =>
            value.length >= 8 ? true : 'Password must be at least 8 characters',
        },
        {
          onCancel: () => {
            console.log(chalk.yellow('\n⚠️  Operation cancelled.'));
            process.exit(1);
          },
        }
      );

      if (!response.password) {
        throw new Error('Password is required for keychain operations');
      }

      // Confirmation - only if this looks like initial setup (not unlock)
      if (promptText.toLowerCase().includes('create') || promptText.toLowerCase().includes('new')) {
        const confirmResponse = await prompts(
          {
            type: 'password',
            name: 'password',
            message: 'Confirm password:',
            validate: (value) => (value === response.password ? true : 'Passwords do not match'),
          },
          {
            onCancel: () => {
              console.log(chalk.yellow('\n⚠️  Operation cancelled.'));
              process.exit(1);
            },
          }
        );

        if (!confirmResponse.password) {
          throw new Error('Password confirmation is required');
        }
      }

      return response.password;
    },
    async getText(promptText) {
      // Text input (not hidden like password)
      const response = await prompts(
        {
          type: 'text',
          name: 'text',
          message: promptText,
        },
        {
          onCancel: () => {
            console.log(chalk.yellow('\n⚠️  Operation cancelled.'));
            process.exit(1);
          },
        }
      );

      if (!response.text) {
        throw new Error('Text input is required');
      }

      return response.text;
    },
  };

  // Parse timeout from --timeout flag (in milliseconds)
  let timeoutMs;
  if (context.flags.timeout) {
    timeoutMs = parseInt(context.flags.timeout, 10);
    if (isNaN(timeoutMs) || timeoutMs <= 0) {
      console.error(
        chalk.red('❌ Invalid timeout value. Must be a positive number in milliseconds.')
      );
      process.exit(1);
    }
    if (context.flags.debug) {
      console.log(chalk.blue(`🔧 API timeout: ${timeoutMs}ms`));
    }
  }

  // Parse --no-retry flag (meow converts --no-retry to retry: false)
  const disableRetries = context.flags.retry === false;
  if (disableRetries && context.flags.debug) {
    console.log(chalk.blue('🔧 API retries disabled'));
  }

  // Resolve API base URL with fallback logic: flag -> config -> production default
  const apiBaseUrl = resolveApiBaseUrl(context.flags.apiUrl, context.flags.debug);

  // Create device key storage provider for the SDK
  const deviceKeyStorageProvider = await createDeviceKeyStorageProvider();

  // Create SDK client instance
  const sshProvider = createSSHKeyProvider(context.flags.sshKey);
  if (context.flags.debug) {
    console.log(chalk.blue('🔧 SSH Key Provider created:', typeof sshProvider));
    if (context.flags.sshKey) {
      console.log(chalk.blue('🔧 Custom SSH key path:', context.flags.sshKey));
    }
  }

  const client = IdentClient.create({
    apiBaseUrl,
    clientId: 'ident-cli',
    scopes: ['user'],
    passwordProvider,
    deviceKeyProvider: createDeviceKeyProvider(),
    deviceKeyStorageProvider,
    sshKeyProvider: sshProvider,
    debug: context.flags.debug,
  });

  // Configure timeout and retry settings if provided
  const retryOptions = {};

  if (timeoutMs) {
    retryOptions.timeout = timeoutMs;
    retryOptions.overallTimeout = Math.max(timeoutMs * 3, 60000); // At least 60 seconds for overall timeout
  }

  if (disableRetries) {
    retryOptions.maxRetries = 0;
  }

  if (Object.keys(retryOptions).length > 0) {
    client.setRetryOptions(retryOptions);
  }

  try {
    await client.ready();

    // Add unlock method selection handler
    client.on('unlock_method_selection', async (data) => {
      const { methods, resolve, reject } = data;

      // Get detailed methods directly instead of trying to work with what the SDK provides
      let displayMethods = [];
      try {
        const detailedMethods = await client.getDetailedUnlockMethods();

        // Build display methods from detailed methods using keyId as unique identifier
        displayMethods = detailedMethods.map((dm) => {
          // Build display name based on method type
          let displayName = dm.method.charAt(0).toUpperCase() + dm.method.slice(1);
          let detail = '';

          if (dm.method === 'password') {
            displayName = dm.description || 'Password';
            if (dm.createdAt) {
              detail = new Date(dm.createdAt).toLocaleDateString();
            }
          } else if (dm.method === 'passkey') {
            displayName = dm.description || 'Passkey';
            // Add type and credential info for passkeys
            if (dm.type === 'passkey-prf') {
              detail = 'PRF';
            } else if (dm.type === 'passkey-blob') {
              detail = 'Large Blob';
            } else if (dm.type === 'passkey-server') {
              detail = 'Touch ID';
            }
            // Add credential ID to distinguish multiple passkeys
            if (dm.credentialId) {
              const shortId = dm.credentialId.substring(0, 8);
              detail = detail ? `${detail} (${shortId}...)` : `(${shortId}...)`;
            }
            if (dm.createdAt) {
              detail += detail ? `, ${new Date(dm.createdAt).toLocaleDateString()}` : new Date(dm.createdAt).toLocaleDateString();
            }
          } else if (dm.method === 'device') {
            displayName = dm.device?.description || `Device Key`;
            if (dm.device?.platform) {
              detail = dm.device.platform;
            }
            if (dm.createdAt) {
              detail += detail ? `, ${new Date(dm.createdAt).toLocaleDateString()}` : new Date(dm.createdAt).toLocaleDateString();
            }
          } else if (dm.method === 'recovery') {
            displayName = 'Recovery Phrase';
            if (dm.createdAt) {
              detail = new Date(dm.createdAt).toLocaleDateString();
            }
          } else if (dm.method === 'ssh') {
            displayName = 'SSH Key';
            if (dm.createdAt) {
              detail = new Date(dm.createdAt).toLocaleDateString();
            }
          }

          return {
            id: dm.keyId,  // Use keyId as the unique identifier
            displayName,
            detail: detail || undefined
          };
        });
      } catch (err) {
        // Fall back to SDK-provided methods if we can't get detailed methods
        displayMethods = methods;
      }

      console.log(chalk.blue('🔐 Multiple unlock methods available. Choose one:'));
      displayMethods.forEach((method, index) => {
        const displayText = method.detail
          ? `${method.displayName} ${chalk.gray(`(${method.detail})`)}`
          : method.displayName;
        console.log(chalk.white(`   ${index + 1}. ${displayText}`));
      });

      prompts({
        type: 'number',
        name: 'choice',
        message: `Select unlock method (1-${displayMethods.length}):`,
        min: 1,
        max: displayMethods.length,
        validate: (value) => {
          if (!value || value < 1 || value > displayMethods.length) {
            return `Please enter a number between 1 and ${displayMethods.length}`;
          }
          return true;
        },
      })
        .then((response) => {
          if (!response.choice) {
            reject(new Error('No unlock method selected'));
          } else {
            const selectedMethod = displayMethods[response.choice - 1];
            console.log(chalk.white(`✅ Selected: ${selectedMethod.displayName}`));
            resolve(selectedMethod.id);
          }
        })
        .catch((error) => {
          reject(error);
        });
    });

    // For write operations, always require authentication (with current user scopes)
    if (subcommand !== 'get' && subcommand !== 'list') {
      await client.ensureAuthenticated();
    }
  } catch (error) {
    console.error(chalk.red('❌ Failed to initialize:'), error.message);
    process.exit(1);
  }

  switch (subcommand) {
    case 'raw': {
      // Alias for get --raw, set the raw flag and fall through
      context.flags.raw = true;
      // falls through
    }
    case 'get': {
      if (!path) {
        console.error(
          `Usage: ${context.personality} fragment get PATH [--raw] [--version=N] [--subject=email:user@domain.com] [--timeout=30000] [--no-retry] [--api-url=URL]`
        );
        process.exit(1);
      }

      try {
        let subjectToUse = context.flags.subject;
        let usePublicAccess = false;

        // If no subject provided, try to determine what to do
        if (!subjectToUse) {
          // Check if we're authenticated
          const session = client.getSession();
          if (!session) {
            // Not authenticated - check if we have a last user to suggest
            if (config.has('lastUser')) {
              const lastUser = config.get('lastUser');
              console.log(chalk.yellow('⚠️  Not authenticated'));
              console.log(chalk.white(`   Try running: ${context.personality} login`));
              console.log(
                chalk.gray(
                  `   Or specify subject for public access: ${context.personality} fragment get ${path} --subject="${lastUser}"`
                )
              );
              process.exit(0);
            } else {
              // No last user - just suggest login or subject
              console.log(chalk.yellow('⚠️  Not authenticated'));
              console.log(chalk.white(`   Try running: ${context.personality} login`));
              console.log(
                chalk.gray(
                  `   Or specify subject for public access: ${context.personality} fragment get ${path} --subject="email:user@domain.com"`
                )
              );
              process.exit(0);
            }
          }
          // If we reach here, we're authenticated and can proceed with normal access
        } else {
          // Subject provided - use public access
          usePublicAccess = true;
        }

        // Parse version flag if provided
        const version = context.flags.version ? parseInt(context.flags.version, 10) : undefined;
        if (version !== undefined && (isNaN(version) || version < 0)) {
          console.error(chalk.red('❌ Version must be a non-negative integer'));
          process.exit(1);
        }

        if (usePublicAccess) {
          if (context.flags.debug) {
            console.log(chalk.white(`🔍 Getting public fragment: ${path}`));
            console.log(chalk.gray(`   From subject: ${subjectToUse}`));
            if (version !== undefined) {
              console.log(chalk.gray(`   Version: ${version}`));
            }
          }
        } else {
          if (context.flags.debug) {
            console.log(chalk.white(`🔍 Getting fragment: ${path}`));
            if (version !== undefined) {
              console.log(chalk.gray(`   Version: ${version}`));
            }
          }
        }

        // Handle --raw flag for raw fragment output
        if (context.flags.raw) {
          if (usePublicAccess) {
            console.error(chalk.red('❌ Raw mode not available with public access (--subject)'));
            console.error(
              chalk.gray('   Raw fragments require authenticated access to your own data')
            );
            process.exit(1);
          } else {
            const opts = version !== undefined ? { version } : {};
            const rawFragment = await client.getRaw(path, opts);
            if (rawFragment) {
              // In raw mode, just output the JSON without decoration
              console.log(JSON.stringify(rawFragment, null, 2));
            } else {
              console.error(chalk.red('❌ Fragment not found'));
              process.exit(1);
            }
            return; // Exit early for raw mode
          }
        }

        if (context.flags.debug) {
          console.log(chalk.cyan('🐛 DEBUG MODE: Fetching raw fragment envelope...'));
          if (usePublicAccess) {
            console.log(chalk.yellow('   (Raw envelope not available in public access mode)'));
          } else {
            const opts = version !== undefined ? { version } : {};
            const rawFragment = await client.getRaw(path, opts);
            if (rawFragment) {
              console.log(chalk.magenta('📦 RAW FRAGMENT ENVELOPE:'));
              console.log(chalk.gray('='.repeat(50)));
              console.log(JSON.stringify(rawFragment, null, 2));
              console.log(chalk.gray('='.repeat(50)));
            }
          }
        }

        let fragment;
        const opts = version !== undefined ? { version } : {};
        if (usePublicAccess) {
          fragment = await client.getPublic(path, subjectToUse, opts);
        } else {
          fragment = await client.get(path, opts);
        }

        if (fragment) {
          console.log(chalk.green('✅ Fragment found:'));
          if (context.flags.debug) {
            console.log(chalk.blue('🔓 DECRYPTED CONTENT:'));
          }
          console.log(JSON.stringify(fragment, null, 2));
        } else {
          console.log(chalk.yellow(`⚠️  Fragment not found: ${path}`));
        }
      } catch (error) {
        console.error(chalk.red('❌ Failed to get fragment:'), error.message);
        if (context.flags.debug) {
          console.error(error);
        }
        process.exit(1);
      }
      break;
    }

    case 'put': {
      if (!path) {
        console.error(
          `Usage: ${context.personality} fragment put PATH [VALUE] [--version=N] [--visibility=public|private] [--timeout=30000] [--no-retry] [--api-url=URL]`
        );
        process.exit(1);
      }

      // Parse version flag if provided
      const version = context.flags.version ? parseInt(context.flags.version, 10) : undefined;
      if (version !== undefined && (isNaN(version) || version < 0)) {
        console.error(chalk.red('❌ Version must be a non-negative integer'));
        process.exit(1);
      }

      let data;
      if (value) {
        // Try to parse as JSON, otherwise use as string
        try {
          data = JSON.parse(value);
        } catch {
          data = value;
        }
      } else {
        // Check if data is available on stdin
        let stdinData = '';

        // Check if stdin is not a TTY (meaning it's piped/redirected)
        if (!process.stdin.isTTY) {
          // Read from stdin
          process.stdin.setEncoding('utf8');

          for await (const chunk of process.stdin) {
            stdinData += chunk;
          }

          stdinData = stdinData.trim();
        }

        if (stdinData) {
          // Use stdin data
          try {
            data = JSON.parse(stdinData);
          } catch {
            data = stdinData;
          }
        } else {
          // Prompt for value
          const response = await prompts(
            {
              type: 'text',
              name: 'data',
              message: `Enter value for fragment ${path} (JSON or string):`,
            },
            {
              onCancel: () => {
                console.log(chalk.yellow('\n⚠️  Operation cancelled.'));
                process.exit(1);
              },
            }
          );

          if (!response.data) {
            console.log(chalk.yellow('⚠️  No data provided, aborting.'));
            process.exit(0);
          }

          try {
            data = JSON.parse(response.data);
          } catch {
            data = response.data;
          }
        }
      }

      // Check for visibility flag or ask for it
      let visibility = context.flags.visibility || context.flags.v;

      if (!visibility) {
        const visibilityResponse = await prompts(
          {
            type: 'select',
            name: 'visibility',
            message: 'Fragment visibility:',
            choices: [
              { title: 'Private (encrypted)', value: 'private' },
              { title: 'Public (plaintext)', value: 'public' },
            ],
            initial: 0,
          },
          {
            onCancel: () => {
              console.log(chalk.yellow('\n⚠️  Operation cancelled.'));
              process.exit(1);
            },
          }
        );

        if (visibilityResponse.visibility === undefined) {
          console.log(chalk.yellow('⚠️  No visibility selected, aborting.'));
          process.exit(0);
        }

        visibility = visibilityResponse.visibility;
      }

      try {
        console.log(chalk.white(`💾 Storing ${visibility} fragment: ${path}`));
        if (version !== undefined) {
          console.log(chalk.gray(`   Version: ${version}`));
        }

        const opts = {
          visibility: visibility,
        };
        if (version !== undefined) {
          opts.version = version;
        }

        await client.put(path, data, opts); // TODO: add tags to meta
        console.log(chalk.green('✅ Fragment stored successfully'));

        if (context.flags.debug) {
          // In debug mode, fetch and show what was actually stored
          console.log(chalk.cyan('🐛 DEBUG MODE: Fetching stored fragment to verify...'));

          const rawFragment = await client.getRaw(path);
          if (rawFragment) {
            console.log(chalk.magenta('📦 STORED FRAGMENT ENVELOPE:'));
            console.log(chalk.gray('='.repeat(50)));
            console.log(JSON.stringify(rawFragment, null, 2));
            console.log(chalk.gray('='.repeat(50)));
          }
        }
      } catch (error) {
        console.error(chalk.red('❌ Failed to store fragment:'), error.message);
        if (context.flags.debug) {
          console.error(error);
        }
        process.exit(1);
      }
      break;
    }

    case 'list':
    case 'ls': {
      const prefix = path || '/';
      const detailed = context.flags.detailed || context.flags.d || context.flags.l;

      try {
        console.log(
          chalk.white(
            `📋 Listing fragments${prefix !== '/' ? ` with prefix: ${prefix}` : ''}${
              detailed ? ' (detailed)' : ''
            }`
          )
        );
        const fragments = await client.list(prefix);

        if (fragments && fragments.length > 0) {
          console.log(chalk.green(`✅ Found ${fragments.length} fragment(s):`));

          if (detailed && fragments.length > 0) {
            // Fetch detailed information for each fragment
            console.log(chalk.gray('Fetching detailed information...'));
            for (let i = 0; i < fragments.length; i++) {
              const fragmentPath =
                typeof fragments[i] === 'string' ? fragments[i] : fragments[i].path;
              try {
                // Get raw fragment to check visibility
                const fullFragment = await client.getRaw(fragmentPath);
                const visibility = getFragmentVisibility(fullFragment);
                const icon =
                  visibility === 'public' ? '🌐' : visibility === 'private' ? '🔒' : '❓';

                console.log(`${i + 1}. ${icon} ${fragmentPath} (${visibility})`);

                if (fullFragment.meta?.ts) {
                  const createdDate = new Date(fullFragment.meta.ts).toISOString();
                  console.log(chalk.gray(`   Created: ${createdDate}`));
                }

                if (fullFragment.fragment) {
                  const size = new TextEncoder().encode(fullFragment.fragment).length;
                  console.log(chalk.gray(`   Size: ${size} bytes`));
                }
              } catch (err) {
                // If we can't get details, fall back to basic display
                const visibility = 'unknown';
                console.log(`${i + 1}. ❓ ${fragmentPath} (${visibility})`);
                console.log(chalk.gray(`   Error getting details: ${err.message}`));
              }
            }
          } else {
            // Basic listing (just paths)
            fragments.forEach((fragment, index) => {
              const path = typeof fragment === 'string' ? fragment : fragment.path;
              console.log(`${index + 1}. ${path}`);
            });
            console.log(chalk.gray(`\n💡 Use --detailed flag to see visibility and metadata`));
          }

          if (context.flags.debug) {
            console.log(chalk.cyan(`🐛 DEBUG - Raw fragments:`));
            console.log(chalk.gray('-'.repeat(30)));
            console.log(JSON.stringify(fragments, null, 2));
            console.log(chalk.gray('-'.repeat(30)));
          }
        } else {
          console.log(chalk.yellow('⚠️  No fragments found'));
        }
      } catch (error) {
        console.error(chalk.red('❌ Failed to list fragments:'), error.message);
        if (context.flags.debug) {
          console.error(error);
        }
        process.exit(1);
      }
      break;
    }

    case 'delete': {
      if (!path) {
        console.error(
          `Usage: ${context.personality} fragment delete PATH [--timeout=30000] [--no-retry] [--api-url=URL]`
        );
        process.exit(1);
      }

      // Confirm deletion
      const confirmResponse = await prompts(
        {
          type: 'confirm',
          name: 'confirm',
          message: `Are you sure you want to delete fragment: ${path}?`,
          initial: false,
        },
        {
          onCancel: () => {
            console.log(chalk.yellow('\n⚠️  Operation cancelled.'));
            process.exit(1);
          },
        }
      );

      if (!confirmResponse.confirm) {
        console.log(chalk.yellow('⚠️  Deletion cancelled'));
        process.exit(0);
      }

      try {
        console.log(chalk.white(`🗑️  Deleting fragment: ${path}`));
        await client.del(path);
        console.log(chalk.green('✅ Fragment deleted successfully'));
      } catch (error) {
        console.error(chalk.red('❌ Failed to delete fragment:'), error.message);
        if (context.flags.debug) {
          console.error(error);
        }
        process.exit(1);
      }
      break;
    }

    case 'recover': {
      if (!path) {
        console.error(
          `Usage: ${context.personality} fragment recover PATH --version=N [--timeout=30000] [--no-retry] [--api-url=URL]`
        );
        process.exit(1);
      }

      const version = context.flags.version;
      if (!version) {
        console.error(chalk.red('❌ Version is required for recover operation'));
        console.error(`Usage: ${context.personality} fragment recover PATH --version=N`);
        process.exit(1);
      }

      // Confirm recovery
      const confirmResponse = await prompts(
        {
          type: 'confirm',
          name: 'confirm',
          message: `Are you sure you want to recover version ${version} of ${path} as the current version?`,
          initial: false,
        },
        {
          onCancel: () => {
            console.log(chalk.yellow('\n⚠️  Operation cancelled.'));
            process.exit(1);
          },
        }
      );

      if (!confirmResponse.confirm) {
        console.log(chalk.yellow('⚠️  Recovery cancelled'));
        process.exit(0);
      }

      try {
        console.log(chalk.white(`🔄 Recovering fragment: ${path} (version ${version})`));
        const result = await client.recover(path, parseInt(version, 10));
        console.log(chalk.green('✅ Fragment recovered successfully'));

        if (context.flags.debug) {
          console.log(chalk.gray('Result:'), result);
        }
      } catch (error) {
        console.error(chalk.red('❌ Failed to recover fragment:'), error.message);
        if (context.flags.debug) {
          console.error(error);
        }
        process.exit(1);
      }
      break;
    }

    default: {
      console.error('Usage:');
      console.error(
        `  ${context.personality} fragment get PATH [--raw] [--version=N] [--subject=email:user@domain.com] [--timeout=30000] [--no-retry] [--api-url=URL]`
      );
      console.error(
        `  ${context.personality} fragment raw PATH [--version=N] [--subject=email:user@domain.com] [--timeout=30000] [--no-retry] [--api-url=URL]`
      );
      console.error(
        `  ${context.personality} fragment put PATH [VALUE] [--version=N] [--visibility=public|private] [--timeout=30000] [--no-retry] [--api-url=URL]`
      );
      console.error(
        `  ${context.personality} fragment list|ls [PREFIX] [-l|--detailed] [--timeout=30000] [--no-retry] [--api-url=URL]`
      );
      console.error(
        `  ${context.personality} fragment delete PATH [--timeout=30000] [--no-retry] [--api-url=URL]`
      );
      console.error(
        `  ${context.personality} fragment recover PATH --version=N [--timeout=30000] [--no-retry] [--api-url=URL]`
      );
      console.error('');
      console.error('Flags:');
      console.error('  --raw       Get raw fragment before decryption (get command only)');
      console.error(
        '  --version   Specific version number to retrieve/create/recover (get, put, and recover commands)'
      );
      console.error('  --subject   Subject for accessing public fragments (get command only)');
      console.error(
        '  --visibility, -v  Fragment visibility: public or private (put command only)'
      );
      console.error('  -l, --detailed  Show visibility and metadata (list/ls command only)');
      console.error(
        '  --ssh-key   Path to SSH private key for unlock (default: ~/.ssh/id_ed25519 or ~/.ssh/id_rsa)'
      );
      console.error('  --timeout   API timeout in milliseconds (default: 30000)');
      console.error('  --no-retry  Disable automatic retries on network errors');
      console.error('  --api-url   API base URL (default: config or https://www.ident.agency)');
      console.error('  --debug     Enable debug output');
      console.error('');
      console.error('Examples:');
      console.error(
        '  echo \'{"name": "John"}\' | identa fragment put profile/user --visibility=public'
      );
      console.error(
        '  cat secrets.json | identa fragment put config/api-keys --visibility=private'
      );
      console.error('  identa fragment put test/simple "hello world" -v public');
      console.error('  identa fragment get profile/user --raw  # Get raw fragment envelope');
      console.error('  identa fragment get profile/user --version=123  # Get specific version');
      console.error(
        '  identa fragment put profile/user "John Smith" --version=124 --visibility=public  # Create specific version'
      );
      process.exit(1);
    }
  }
};
