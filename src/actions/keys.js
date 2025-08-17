import { createHash, randomBytes } from 'crypto';

import { IdentClient } from '../../../ident-agency-sdk/lib-js/index.js';
import chalk from 'chalk';
import config from '../lib/config.js';
import fs from 'fs/promises';
import fsSync from 'fs';
import { getSecretProvider } from '../lib/secrets.js';
import os from 'os';
import path from 'path';
import prompts from 'prompts';
import { resolveApiBaseUrl } from '../lib/api-url.js';

export const description = 'Authentication key management (register, list, remove, test)';

export const exec = async (context) => {
  const [cmd, subcommand, ...rest] = context.input;

  if (context.flags.debug) {
    console.log(chalk.blue(`Running keys command: ${subcommand}`));
  }

  switch (subcommand) {
    case 'register': {
      await registerCommand(context);
      break;
    }

    case 'list': {
      await listCommand(context);
      break;
    }

    case 'remove': {
      await removeCommand(context);
      break;
    }

    case 'test': {
      await testCommand(context);
      break;
    }

    case 'device': {
      await deviceCommand(context);
      break;
    }

    case 'recovery': {
      await recoveryCommand(context);
      break;
    }

    case 'ssh': {
      await sshCommand(context);
      break;
    }

    default: {
      console.error('Usage:');
      console.error(`  ${context.personality} keys register [--api-url=URL] [--debug]`);
      console.error(`  ${context.personality} keys list [--api-url=URL] [--debug]`);
      console.error(
        `  ${context.personality} keys remove METHOD [KEY_ID] [--api-url=URL] [--debug] [--yes]`
      );
      console.error(
        `  ${context.personality} keys test [METHOD] [KEY_ID] [--api-url=URL] [--debug]`
      );
      console.error(`  ${context.personality} keys device [--api-url=URL] [--debug] [--yes]`);
      console.error(
        `  ${context.personality} keys recovery [--words=24] [--api-url=URL] [--debug]`
      );
      console.error(`  ${context.personality} keys ssh [--ssh-key=PATH] [--api-url=URL] [--debug]`);
      console.error('');
      console.error('Commands:');
      console.error('  register   Register a new authentication key (passkey via browser)');
      console.error('  list       List available authentication keys in keychain');
      console.error('  remove     Remove an authentication key from keychain');
      console.error(
        '  test       Test an authentication key (password, device, and recovery in CLI)'
      );
      console.error('  device     Generate and register a device-specific unlock key');
      console.error('  recovery   Generate or import a BIP-39 mnemonic for recovery');
      console.error('  ssh        Add an SSH key as an unlock method');
      console.error('');
      console.error('Global Flags:');
      console.error('  --api-url  API base URL (default: config or https://www.ident.agency)');
      console.error('  --ssh-key  Path to SSH private key (default: ~/.ssh/id_ed25519 or ~/.ssh/id_rsa)');
      console.error('  --debug    Enable debug output');
      console.error('  --yes      Skip confirmation prompts (auto-confirm)');
      process.exit(1);
    }
  }
};

async function registerCommand(context) {
  try {
    // Create password provider for keychain operations
    const passwordProvider = {
      async getPassword(promptText) {
        console.log(chalk.blue('🔐 Keychain password required'));

        const response = await prompts({
          type: 'password',
          name: 'password',
          message: promptText,
          validate: (value) =>
            value.length >= 8 ? true : 'Password must be at least 8 characters',
        });

        if (!response.password) {
          throw new Error('Password is required for keychain operations');
        }

        return response.password;
      },
    };

    // Resolve API base URL with fallback logic: flag -> config -> production default
    const apiBaseUrl = resolveApiBaseUrl(context.flags.apiUrl, context.flags.debug);

    console.log(chalk.white('🔐 Initializing Ident SDK...'));

    // Create SDK client instance
    const client = IdentClient.create({
      apiBaseUrl,
      clientId: 'ident-cli',
      scopes: ['user', 'vault.read', 'vault.write', 'vault.decrypt'],
      passwordProvider,
      deviceKeyProvider: createDeviceKeyProvider(),
      sshKeyProvider: createSSHKeyProvider(context.flags.sshKey),
      debug: context.flags.debug,
    });

    await client.ready();

    // Check if authenticated
    const session = client.getSession();
    if (!session) {
      console.log(chalk.yellow('⚠️  Not authenticated. Run login first.'));
      console.log(chalk.white(`   ${context.personality} auth login`));
      process.exit(1);
    }

    console.log(chalk.white('👤 Current session:'));
    console.log(chalk.white(`   Subject: ${session.subject.id}`));

    // Check if passkey is supported (CLI limitation)
    console.error(chalk.red('❌ Passkey registration is not available in CLI'));
    console.error(chalk.white('   Passkeys require a browser environment with WebAuthn support'));
    console.error(chalk.white('   Use the web interface to register passkeys:'));
    console.error(chalk.white(`   ${apiBaseUrl}/example`));
    process.exit(1);
  } catch (error) {
    console.error(chalk.red('❌ Key registration failed:'), error.message);
    if (context.flags.debug) {
      console.error(error);
    }
    process.exit(1);
  }
}

async function listCommand(context) {
  try {
    // Create password provider for keychain operations
    const passwordProvider = {
      async getPassword(promptText) {
        const response = await prompts({
          type: 'password',
          name: 'password',
          message: promptText,
          validate: (value) =>
            value.length >= 8 ? true : 'Password must be at least 8 characters',
        });

        if (!response.password) {
          throw new Error('Password is required for keychain operations');
        }

        return response.password;
      },
    };

    // Resolve API base URL with fallback logic: flag -> config -> production default
    const apiBaseUrl = resolveApiBaseUrl(context.flags.apiUrl, context.flags.debug);

    // Create SDK client instance
    const client = IdentClient.create({
      apiBaseUrl,
      clientId: 'ident-cli',
      scopes: ['user', 'vault.read', 'vault.decrypt'],
      passwordProvider,
      deviceKeyProvider: createDeviceKeyProvider(),
      sshKeyProvider: createSSHKeyProvider(context.flags.sshKey),
      debug: context.flags.debug,
    });

    console.log(chalk.white('🔐 Initializing Ident SDK...'));
    await client.ready();

    // Add unlock method selection handler
    client.on('unlock_method_selection', (data) => {
      const { methods, resolve, reject } = data;

      console.log(chalk.blue('🔐 Multiple unlock methods available. Choose one:'));
      methods.forEach((method, index) => {
        const displayText = method.detail
          ? `${method.displayName} ${chalk.gray(`(${method.detail})`)}`
          : method.displayName;
        console.log(chalk.white(`   ${index + 1}. ${displayText}`));
      });

      prompts({
        type: 'number',
        name: 'choice',
        message: 'Select unlock method',
        min: 1,
        max: methods.length,
        initial: 1,
      })
        .then((answer) => {
          const selectedMethod = methods[answer.choice - 1];
          resolve(selectedMethod.id);
        })
        .catch(reject);
    });

    // Check if authenticated
    const session = client.getSession();
    if (!session) {
      console.log(chalk.yellow('⚠️  Not authenticated. Run login first.'));
      console.log(chalk.white(`   ${context.personality} auth login`));
      process.exit(1);
    }

    console.log(chalk.green('🔑 Unlock Methods'));
    console.log(chalk.white(`   Subject: ${session.subject.id}`));

    try {
      // Get detailed unlock methods
      const detailedMethods = await client.getDetailedUnlockMethods();

      if (detailedMethods.length === 0) {
        console.log(chalk.yellow('   No unlock methods found'));
        console.log(
          chalk.gray(`   Run "${context.personality} auth login" to initialize keychain`)
        );
      } else {
        console.log(chalk.white(`   Available methods: ${detailedMethods.length}`));
        console.log('');

        detailedMethods.forEach((method, index) => {
          const icon =
            method.method === 'password'
              ? '🔒'
              : method.method.startsWith('passkey')
              ? '🔑'
              : method.method === 'recovery'
              ? '🔄'
              : method.method === 'device'
              ? '💻'
              : '❓';

          // Display method name with description for devices
          let methodName = method.method;
          if (method.method === 'device' && method.device?.description) {
            methodName = `device - ${method.device.description}`;
          }

          console.log(chalk.white(`   ${index + 1}. ${icon} ${methodName}`));
          console.log(chalk.gray(`      ID: ${method.keyId}`));

          if (method.type) {
            console.log(chalk.gray(`      Type: ${method.type}`));
          }

          if (method.createdAt) {
            const createdDate = new Date(method.createdAt).toISOString();
            console.log(chalk.gray(`      Created: ${createdDate}`));
          }

          if (method.credentialId) {
            console.log(chalk.gray(`      Credential: ${method.credentialId.substring(0, 16)}...`));
          }

          // Display device-specific information
          if (method.device) {
            if (method.device.description) {
              console.log(chalk.gray(`      Description: ${method.device.description}`));
            }
            if (method.device.platform) {
              console.log(chalk.gray(`      Platform: ${method.device.platform}`));
            }
            if (method.device.device_id) {
              console.log(chalk.gray(`      Device ID: ${method.device.device_id}`));
            }
          }

          console.log('');
        });

        // Show usage examples
        console.log(chalk.blue('💡 Usage examples:'));
        console.log(
          chalk.gray(
            `   Remove: ${context.personality} keys remove password ${
              detailedMethods[0]?.keyId || 'KEY_ID'
            }`
          )
        );
        console.log(
          chalk.gray(
            `   Test:   ${context.personality} keys test password ${
              detailedMethods[0]?.keyId || 'KEY_ID'
            }`
          )
        );
      }

      // Show unlock status
      const unlockInfo = await client.getUnlockMethods();
      console.log(
        chalk.white(
          `   Status: ${unlockInfo.isUnlocked ? chalk.green('Unlocked') : chalk.yellow('Locked')}`
        )
      );
    } catch (error) {
      console.log(chalk.yellow('   Could not load detailed unlock methods'));
      console.log(chalk.gray(`   Error: ${error.message}`));

      // Fallback to basic method listing
      await client.loadKeychainMetadata?.();
      if (client.keychainCache?.availableMethods) {
        const methods = client.keychainCache.availableMethods;
        console.log(chalk.white(`   Basic methods: ${methods.join(', ')}`));
      }
    }
  } catch (error) {
    console.error(chalk.red('❌ Failed to list unlock methods:'), error.message);
    if (context.flags.debug) {
      console.error(error);
    }
    process.exit(1);
  }
}

async function removeCommand(context) {
  const [method, keyId] = context.input.slice(2);

  if (!method) {
    console.error(`Usage: ${context.personality} keys remove METHOD [KEY_ID]`);
    console.error('Examples:');
    console.error(`  ${context.personality} keys remove password password:v1`);
    console.error(`  ${context.personality} keys remove passkey-prf passkey-prf:abc123`);
    process.exit(1);
  }

  try {
    // Create password provider for keychain operations
    const passwordProvider = {
      async getPassword(promptText) {
        const response = await prompts({
          type: 'password',
          name: 'password',
          message: promptText,
          validate: (value) =>
            value.length >= 8 ? true : 'Password must be at least 8 characters',
        });

        if (!response.password) {
          throw new Error('Password is required for keychain operations');
        }

        return response.password;
      },
    };

    // Resolve API base URL with fallback logic: flag -> config -> production default
    const apiBaseUrl = resolveApiBaseUrl(context.flags.apiUrl, context.flags.debug);

    // Create SDK client instance
    const client = IdentClient.create({
      apiBaseUrl,
      clientId: 'ident-cli',
      scopes: ['user', 'vault.read', 'vault.write', 'vault.decrypt'],
      passwordProvider,
      deviceKeyProvider: createDeviceKeyProvider(),
      sshKeyProvider: createSSHKeyProvider(context.flags.sshKey),
      debug: context.flags.debug,
    });

    console.log(chalk.white('🔐 Initializing Ident SDK...'));
    await client.ready();

    // Add unlock method selection handler
    client.on('unlock_method_selection', (data) => {
      const { methods, resolve, reject } = data;

      console.log(chalk.blue('🔐 Multiple unlock methods available. Choose one:'));
      methods.forEach((method, index) => {
        const displayText = method.detail
          ? `${method.displayName} ${chalk.gray(`(${method.detail})`)}`
          : method.displayName;
        console.log(chalk.white(`   ${index + 1}. ${displayText}`));
      });

      prompts({
        type: 'number',
        name: 'choice',
        message: 'Select unlock method',
        min: 1,
        max: methods.length,
        initial: 1,
      })
        .then((answer) => {
          const selectedMethod = methods[answer.choice - 1];
          resolve(selectedMethod.id);
        })
        .catch(reject);
    });

    // Check if authenticated
    const session = client.getSession();
    if (!session) {
      console.log(chalk.yellow('⚠️  Not authenticated. Run login first.'));
      console.log(chalk.white(`   ${context.personality} auth login`));
      process.exit(1);
    }

    // Show available methods first
    const detailedMethods = await client.getDetailedUnlockMethods();
    if (detailedMethods.length === 0) {
      console.log(chalk.yellow('⚠️  No unlock methods found to remove'));
      process.exit(1);
    }

    console.log(chalk.white('🔑 Available unlock methods:'));
    detailedMethods.forEach((m, index) => {
      const icon =
        m.method === 'password'
          ? '🔒'
          : m.method.startsWith('passkey')
          ? '🔑'
          : m.method === 'device'
          ? '💻'
          : '❓';
      console.log(chalk.white(`   ${index + 1}. ${icon} ${m.method} (${m.keyId})`));
    });
    console.log('');

    // Find the method to remove
    let targetMethod = detailedMethods.find(
      (m) => m.method === method && (!keyId || m.keyId === keyId)
    );

    if (!targetMethod && keyId) {
      // Try to find by keyId alone
      targetMethod = detailedMethods.find((m) => m.keyId === keyId);
    }

    if (!targetMethod) {
      // Try to find by method type alone (if no keyId specified)
      const methodMatches = detailedMethods.filter((m) => m.method === method);
      if (methodMatches.length === 1) {
        targetMethod = methodMatches[0];
      } else if (methodMatches.length > 1) {
        console.error(chalk.red(`❌ Multiple ${method} methods found. Please specify KEY_ID:`));
        methodMatches.forEach((m, index) => {
          console.error(chalk.white(`   ${index + 1}. ${m.keyId}`));
        });
        process.exit(1);
      }
    }

    if (!targetMethod) {
      console.error(
        chalk.red(`❌ Unlock method not found: ${method}${keyId ? ` (${keyId})` : ''}`)
      );
      process.exit(1);
    }

    // Confirm removal
    if (context.flags.yes) {
      console.log(
        chalk.white(
          `🗑️  --yes flag provided, removing ${targetMethod.method} (${targetMethod.keyId})`
        )
      );
    } else {
      const confirmResponse = await prompts({
        type: 'confirm',
        name: 'confirm',
        message: `Remove unlock method ${targetMethod.method} (${targetMethod.keyId})?`,
        initial: false,
      });

      if (!confirmResponse.confirm) {
        console.log(chalk.yellow('⚠️  Removal cancelled'));
        process.exit(0);
      }
    }

    // Warning about removing all methods
    if (detailedMethods.length === 1) {
      console.log(chalk.red('⚠️  WARNING: This is your last unlock method!'));

      if (context.flags.yes) {
        console.log(chalk.white('   --yes flag provided, proceeding despite warning'));
      } else {
        const finalConfirm = await prompts({
          type: 'confirm',
          name: 'confirm',
          message: 'You will lose access to encrypted fragments. Continue?',
          initial: false,
        });

        if (!finalConfirm.confirm) {
          console.log(chalk.yellow('⚠️  Removal cancelled'));
          process.exit(0);
        }
      }
    }

    console.log(
      chalk.white(`🗑️  Removing unlock method: ${targetMethod.method} (${targetMethod.keyId})`)
    );
    await client.removeUnlockMethod(targetMethod.method, targetMethod.keyId);
    console.log(chalk.green('✅ Unlock method removed successfully'));
  } catch (error) {
    console.error(chalk.red('❌ Failed to remove unlock method:'), error.message);
    if (context.flags.debug) {
      console.error(error);
    }
    process.exit(1);
  }
}

async function testCommand(context) {
  let [method, keyId] = context.input.slice(2);

  try {
    // Create password provider for keychain operations
    const passwordProvider = {
      async getPassword(promptText) {
        const response = await prompts({
          type: 'password',
          name: 'password',
          message: promptText,
          validate: (value) =>
            value.length >= 8 ? true : 'Password must be at least 8 characters',
        });

        if (!response.password) {
          throw new Error('Password is required for keychain operations');
        }

        return response.password;
      },
    };

    // Resolve API base URL with fallback logic: flag -> config -> production default
    const apiBaseUrl = resolveApiBaseUrl(context.flags.apiUrl, context.flags.debug);

    // Create SDK client instance
    const client = IdentClient.create({
      apiBaseUrl,
      clientId: 'ident-cli',
      scopes: ['user', 'vault.read', 'vault.decrypt'],
      passwordProvider,
      deviceKeyProvider: createDeviceKeyProvider(),
      sshKeyProvider: createSSHKeyProvider(context.flags.sshKey),
      debug: context.flags.debug,
    });

    console.log(chalk.white('🔐 Initializing Ident SDK...'));
    await client.ready();

    // Add unlock method selection handler
    client.on('unlock_method_selection', (data) => {
      const { methods, resolve, reject } = data;

      console.log(chalk.blue('🔐 Multiple unlock methods available. Choose one:'));
      methods.forEach((method, index) => {
        const displayText = method.detail
          ? `${method.displayName} ${chalk.gray(`(${method.detail})`)}`
          : method.displayName;
        console.log(chalk.white(`   ${index + 1}. ${displayText}`));
      });

      prompts({
        type: 'number',
        name: 'choice',
        message: 'Select unlock method',
        min: 1,
        max: methods.length,
        initial: 1,
      })
        .then((answer) => {
          const selectedMethod = methods[answer.choice - 1];
          resolve(selectedMethod.id);
        })
        .catch(reject);
    });

    // Check if authenticated
    const session = client.getSession();
    if (!session) {
      console.log(chalk.yellow('⚠️  Not authenticated. Run login first.'));
      console.log(chalk.white(`   ${context.personality} auth login`));
      process.exit(1);
    }

    // If no method provided, show selection list
    if (!method) {
      const detailedMethods = await client.getDetailedUnlockMethods();
      if (detailedMethods.length === 0) {
        console.log(chalk.yellow('⚠️  No unlock methods found to test'));
        process.exit(1);
      }

      // Filter to methods that are testable in CLI
      const testableMethods = detailedMethods.filter(
        (m) => m.method === 'password' || m.method === 'device' || m.method === 'recovery'
      );

      if (testableMethods.length === 0) {
        console.log(chalk.yellow('⚠️  No CLI-testable unlock methods found'));
        console.log(
          chalk.white('   Only password, device, and recovery methods can be tested in CLI')
        );
        console.log(chalk.white('   Use the web interface to test passkey methods'));
        process.exit(1);
      }

      console.log(chalk.green('🧪 Available unlock methods to test:'));

      // Create selection options
      const choices = testableMethods.map((method, index) => {
        const icon =
          method.method === 'password'
            ? '🔒'
            : method.method === 'device'
            ? '💻'
            : method.method === 'recovery'
            ? '🔄'
            : '❓';

        let displayName = `${icon} ${method.method}`;
        if (method.method === 'device' && method.device?.description) {
          displayName = `${icon} device - ${method.device.description}`;
        }

        return {
          title: `${displayName} (${method.keyId})`,
          value: { method: method.method, keyId: method.keyId },
        };
      });

      const selection = await prompts({
        type: 'select',
        name: 'selected',
        message: 'Which unlock method would you like to test?',
        choices: choices,
        initial: 0,
      });

      if (!selection.selected) {
        console.log(chalk.yellow('⚠️  No method selected, aborting.'));
        process.exit(0);
      }

      method = selection.selected.method;
      keyId = selection.selected.keyId;

      console.log(chalk.white(`Testing ${method} method (${keyId})`));
      console.log();
    }

    // Check if method is supported in CLI
    if (method.startsWith('passkey')) {
      console.error(chalk.red('❌ Passkey testing is not available in CLI'));
      console.error(chalk.white('   Passkeys require a browser environment with WebAuthn support'));
      console.error(chalk.white('   Use the web interface to test passkeys:'));
      console.error(chalk.white(`   ${apiBaseUrl}/example`));
      process.exit(1);
    }

    if (method !== 'password' && method !== 'device' && method !== 'recovery') {
      console.error(chalk.red(`❌ Testing method '${method}' is not supported in CLI`));
      console.error(
        chalk.white('   Only password, device, and recovery testing is supported in CLI')
      );
      process.exit(1);
    }

    // Get available methods to find the target
    const detailedMethods = await client.getDetailedUnlockMethods();
    let targetMethod;

    // If keyId is specified, find by keyId first
    if (keyId) {
      targetMethod =
        detailedMethods.find((m) => m.keyId === keyId) ||
        detailedMethods.find((m) => m.method === method && m.keyId === keyId);
    } else {
      // No keyId specified - check for method matches
      const methodMatches = detailedMethods.filter((m) => m.method === method);
      if (methodMatches.length === 1) {
        targetMethod = methodMatches[0];
      } else if (methodMatches.length > 1) {
        if (method === 'recovery') {
          // For recovery methods, test all of them
          console.log(
            chalk.yellow(`💡 Found ${methodMatches.length} recovery methods - testing all of them:`)
          );
          for (const recoveryMethod of methodMatches) {
            console.log(
              chalk.white(
                `\n🧪 Testing recovery method: ${recoveryMethod.keyId} (created ${new Date(
                  recoveryMethod.createdAt
                ).toLocaleString()})`
              )
            );
            await testRecoveryMethod(client, recoveryMethod, context);
          }
          return; // Exit after testing all recovery methods
        } else {
          console.error(chalk.red(`❌ Multiple ${method} methods found. Please specify KEY_ID:`));
          methodMatches.forEach((m, index) => {
            console.error(chalk.white(`   ${index + 1}. ${m.keyId}`));
          });
          process.exit(1);
        }
      }
    }

    if (!targetMethod) {
      console.error(
        chalk.red(`❌ Unlock method not found: ${method}${keyId ? ` (${keyId})` : ''}`)
      );
      process.exit(1);
    }

    console.log(
      chalk.white(`🧪 Testing unlock method: ${targetMethod.method} (${targetMethod.keyId})`)
    );

    if (method === 'device') {
      // For device method, we need to get the actual WrappedSeed object
      try {
        // Load keychain to get the wrapped seeds
        await client.ensureKeychainReady();
        await client.cryptoManager?.ensureKeychainLoaded();

        if (!client.cryptoManager) {
          throw new Error('Crypto manager not available');
        }

        // Find the actual WrappedSeed by keyId
        const wrappedSeed = client.cryptoManager.wrappedSeeds.find(
          (ws) => ws.keyId === targetMethod.keyId
        );
        if (!wrappedSeed) {
          throw new Error(`WrappedSeed not found for keyId: ${targetMethod.keyId}`);
        }

        console.log(chalk.white('   Found wrapped seed, testing device key...'));
        const deviceKeyProvider = createDeviceKeyProvider();
        await client.unlockWithDevice(wrappedSeed, deviceKeyProvider);
        console.log(chalk.green('✅ Device unlock method test successful'));
        console.log(chalk.white('   Device key was found and successfully unlocked keychain'));
      } catch (error) {
        console.error(chalk.red('❌ Device unlock test failed:'), error.message);
        if (context.flags.debug) {
          console.error(error);
        }
        process.exit(1);
      }
    } else if (method === 'password') {
      // For password, test the specific password method
      try {
        console.log(chalk.white('   Testing password unlock...'));

        // Load keychain to get the wrapped seeds
        await client.ensureKeychainReady();
        await client.cryptoManager?.ensureKeychainLoaded();

        if (!client.cryptoManager) {
          throw new Error('Crypto manager not available');
        }

        // Find the actual WrappedSeed by keyId
        const wrappedSeed = client.cryptoManager.wrappedSeeds.find(
          (ws) => ws.keyId === targetMethod.keyId
        );
        if (!wrappedSeed) {
          throw new Error(`WrappedSeed not found for keyId: ${targetMethod.keyId}`);
        }

        // If already unlocked, lock first to test properly
        if (client.cryptoManager.isUnlocked) {
          client.cryptoManager.lock();
          console.log(chalk.white('   Locked keychain to test password unlock'));
        }

        // Get the password from the provider
        const password = await client.config.passwordProvider.getPassword(
          'Enter password to test unlock:'
        );

        // Test the specific password method by unlocking with it
        await client.cryptoManager.unlockWithPassword(password, wrappedSeed);
        console.log(chalk.green('✅ Password unlock method test successful'));
        console.log(chalk.white('   Password was correct and keychain unlocked'));
      } catch (error) {
        console.error(chalk.red('❌ Password unlock test failed:'), error.message);
        if (context.flags.debug) {
          console.error(error);
        }
        process.exit(1);
      }
    } else if (method === 'recovery') {
      // For recovery method, test the specific mnemonic
      const success = await testRecoveryMethod(client, targetMethod, context);
      if (!success) {
        process.exit(1);
      }
    }
  } catch (error) {
    console.error(chalk.red('❌ Failed to test unlock method:'), error.message);
    if (context.flags.debug) {
      console.error(error);
    }
    process.exit(1);
  }
}

// Generate a stable device ID based on system characteristics
function generateDeviceId() {
  const platformInfo = `${os.platform()}-${os.hostname()}-${os.userInfo().username}`;
  const hash = createHash('sha256').update(platformInfo).digest('hex');
  return hash.substring(0, 16); // Use first 16 characters as device ID
}

// Get platform info for device method metadata
function getPlatformInfo() {
  const platform = os.platform();
  let platformName, secureStore;

  switch (platform) {
    case 'darwin':
      platformName = 'macOS';
      secureStore = 'Keychain';
      break;
    case 'win32':
      platformName = 'Windows';
      secureStore = 'DPAPI';
      break;
    case 'linux':
      platformName = 'Linux';
      secureStore = 'Secret Service';
      break;
    default:
      platformName = platform;
      secureStore = 'Keytar';
  }

  return { platform: platformName, secureStore };
}

// Create a device key provider function for CLI
function createDeviceKeyProvider() {
  return async (deviceId) => {
    const secrets = await getSecretProvider();
    const service = 'ident-agency-cli';
    const key = `device-key-${deviceId}`;

    const deviceKeyB64 = await secrets.get(service, key);
    if (!deviceKeyB64) {
      throw new Error(`Device key not found for device ID: ${deviceId}`);
    }

    return Buffer.from(deviceKeyB64, 'base64');
  };
}

// Create an SSH key provider function for CLI
function createSSHKeyProvider(customKeyPath) {
  return async (keyId) => {
    // Try to find the SSH private key
    // First try the default location
    const defaultKeyPath = path.join(os.homedir(), '.ssh', 'id_ed25519');
    const rsaKeyPath = path.join(os.homedir(), '.ssh', 'id_rsa');
    
    let keyPath;
    
    // If custom key path provided via flag, use it
    if (customKeyPath) {
      // Expand ~ to home directory if present
      keyPath = customKeyPath.replace(/^~/, os.homedir());
      
      if (!fsSync.existsSync(keyPath)) {
        console.error(chalk.red(`❌ SSH key not found at: ${keyPath}`));
        // Fall back to prompting
        const response = await prompts({
          type: 'text',
          name: 'keyPath',
          message: 'Enter path to SSH private key:',
          initial: defaultKeyPath
        });
        if (!response.keyPath) {
          throw new Error('SSH key path is required');
        }
        keyPath = response.keyPath.replace(/^~/, os.homedir());
      }
    } else {
      // Try default locations
      keyPath = defaultKeyPath;
      if (!fsSync.existsSync(keyPath)) {
        if (fsSync.existsSync(rsaKeyPath)) {
          keyPath = rsaKeyPath;
        } else {
          // Prompt for custom path
          console.log(chalk.yellow('⚠️  Default SSH keys not found (id_ed25519 or id_rsa)'));
          const response = await prompts({
            type: 'text',
            name: 'keyPath',
            message: 'Enter path to SSH private key:',
            initial: defaultKeyPath
          });
          if (!response.keyPath) {
            throw new Error('SSH key path is required');
          }
          keyPath = response.keyPath.replace(/^~/, os.homedir());
        }
      }
    }
    
    // Verify the key exists before trying to read it
    if (!fsSync.existsSync(keyPath)) {
      throw new Error(`SSH key not found at: ${keyPath}`);
    }
    
    // Read the private key
    const privateKey = fsSync.readFileSync(keyPath, 'utf8');
    
    // Check if passphrase is needed
    let passphrase;
    if (privateKey.includes('ENCRYPTED')) {
      const response = await prompts({
        type: 'password',
        name: 'passphrase',
        message: `Enter passphrase for SSH key (${path.basename(keyPath)}):`
      });
      passphrase = response.passphrase;
    }
    
    return { privateKey, passphrase };
  };
}

async function deviceCommand(context) {
  try {
    // Create password provider for keychain operations
    const passwordProvider = {
      async getPassword(promptText) {
        console.log(chalk.blue('🔐 Keychain password required'));

        const response = await prompts({
          type: 'password',
          name: 'password',
          message: promptText,
          validate: (value) =>
            value.length >= 8 ? true : 'Password must be at least 8 characters',
        });

        if (!response.password) {
          throw new Error('Password is required for keychain operations');
        }

        return response.password;
      },
    };

    // Resolve API base URL with fallback logic: flag -> config -> production default
    const apiBaseUrl = resolveApiBaseUrl(context.flags.apiUrl, context.flags.debug);

    console.log(chalk.white('🔐 Initializing Ident SDK...'));

    // Create SDK client instance
    const client = IdentClient.create({
      apiBaseUrl,
      clientId: 'ident-cli',
      scopes: ['user', 'vault.read', 'vault.write', 'vault.decrypt'],
      passwordProvider,
      deviceKeyProvider: createDeviceKeyProvider(),
      sshKeyProvider: createSSHKeyProvider(context.flags.sshKey),
      debug: context.flags.debug,
    });

    await client.ready();

    // Add unlock method selection handler
    client.on('unlock_method_selection', (data) => {
      const { methods, resolve, reject } = data;

      console.log(chalk.blue('🔐 Multiple unlock methods available. Choose one:'));
      methods.forEach((method, index) => {
        const displayText = method.detail
          ? `${method.displayName} ${chalk.gray(`(${method.detail})`)}`
          : method.displayName;
        console.log(chalk.white(`   ${index + 1}. ${displayText}`));
      });

      prompts({
        type: 'number',
        name: 'choice',
        message: 'Select unlock method',
        min: 1,
        max: methods.length,
        initial: 1,
      })
        .then((answer) => {
          const selectedMethod = methods[answer.choice - 1];
          resolve(selectedMethod.id);
        })
        .catch(reject);
    });

    // Check if authenticated
    const session = client.getSession();
    if (!session) {
      console.log(chalk.yellow('⚠️  Not authenticated. Run login first.'));
      console.log(chalk.white(`   ${context.personality} auth login`));
      process.exit(1);
    }

    console.log(chalk.white('👤 Current session:'));
    console.log(chalk.white(`   Subject: ${session.subject.id}`));

    // Generate device ID and platform info
    const deviceId = generateDeviceId();
    const { platform, secureStore } = getPlatformInfo();

    console.log(chalk.white('💻 Device information:'));
    console.log(chalk.white(`   Device ID: ${deviceId}`));
    console.log(chalk.white(`   Platform: ${platform}`));
    console.log(chalk.white(`   Secure Store: ${secureStore}`));
    console.log('');

    // Ask for device description
    const descriptionResponse = await prompts({
      type: 'text',
      name: 'description',
      message: 'Enter a description for this device (e.g., "MacBook Pro - Work")',
      initial: `${platform} Device`,
    });

    const deviceDescription = descriptionResponse.description || `${platform} Device`;
    console.log(chalk.white(`   Description: ${deviceDescription}`));
    console.log('');

    // Initialize secrets provider
    const secrets = await getSecretProvider();
    const service = 'ident-agency-cli';
    const key = `device-key-${deviceId}`;

    // Check if device key already exists
    const existingKey = await secrets.get(service, key);

    if (existingKey) {
      console.log(chalk.yellow('⚠️  Device key already exists for this device'));

      if (context.flags.yes) {
        console.log(chalk.white('   --yes flag provided, replacing existing device key'));
      } else {
        const replaceResponse = await prompts({
          type: 'confirm',
          name: 'replace',
          message: 'Replace existing device key?',
          initial: false,
        });

        if (!replaceResponse.replace) {
          console.log(chalk.yellow('⚠️  Device key generation cancelled'));
          process.exit(0);
        }
      }
    }

    // Generate new device key (32 random bytes)
    console.log(chalk.white('🔑 Generating device key...'));
    const deviceKey = randomBytes(32);
    const deviceKeyB64 = deviceKey.toString('base64');

    // Store device key using secrets abstraction
    await secrets.set(service, key, deviceKeyB64);
    console.log(chalk.green('✅ Device key stored in secure storage'));

    // Add device unlock method to SDK keychain
    console.log(chalk.white('📝 Adding device unlock method to keychain...'));

    // Create a unique key ID to avoid replacing existing devices
    const timestamp = Date.now();
    const uniqueKeyId = `device:${deviceId}:${timestamp}`;

    const wrappedSeed = await client.addUnlockMethod('device', {
      dkBytes: deviceKey, // Provide raw device key bytes
      deviceId,
      platform,
      secureStore,
      description: deviceDescription,
      keyId: uniqueKeyId, // Use unique key ID to prevent replacement
    });

    console.log(chalk.green('✅ Device unlock method added to keychain'));
    console.log(chalk.white(`   Method ID: ${wrappedSeed.keyId}`));
    console.log(chalk.white(`   Keychain updated with device key wrapper`));
    console.log('');

    console.log(chalk.blue('💡 Usage:'));
    console.log(
      chalk.gray(`   Test:   ${context.personality} keys test device ${wrappedSeed.keyId}`)
    );
    console.log(
      chalk.gray(`   Remove: ${context.personality} keys remove device ${wrappedSeed.keyId}`)
    );
    console.log('');

    console.log(chalk.yellow('⚠️  Important: This device key is tied to this specific device'));
    console.log(
      chalk.white('   If you lose access to this device, you will need other unlock methods')
    );
    console.log(chalk.white('   Make sure you have password or passkey methods as backup'));
  } catch (error) {
    console.error(chalk.red('❌ Device key generation failed:'), error.message);
    if (context.flags.debug) {
      console.error(error);
    }
    process.exit(1);
  }
}

// Helper function to test a specific recovery method
async function testRecoveryMethod(client, targetMethod, context) {
  try {
    console.log(chalk.white('   Testing recovery mnemonic unlock...'));

    // Load keychain to get the wrapped seeds
    await client.ensureKeychainReady();
    await client.cryptoManager?.ensureKeychainLoaded();

    if (!client.cryptoManager) {
      throw new Error('Crypto manager not available');
    }

    // Find the actual WrappedSeed by keyId
    const wrappedSeed = client.cryptoManager.wrappedSeeds.find(
      (ws) => ws.keyId === targetMethod.keyId
    );
    if (!wrappedSeed) {
      throw new Error(`WrappedSeed not found for keyId: ${targetMethod.keyId}`);
    }

    // If already unlocked, lock first to test properly
    if (client.cryptoManager.isUnlocked) {
      client.cryptoManager.lock();
      console.log(chalk.white('   Locked keychain to test recovery unlock'));
    }

    // Get the recovery mnemonic from user
    const mnemonicResponse = await prompts(
      {
        type: 'text',
        name: 'mnemonic',
        message: 'Enter your recovery mnemonic (12-24 words):',
        validate: (value) => {
          const words = value.trim().split(/\s+/);
          return words.length >= 12 && words.length <= 24 ? true : 'Mnemonic must be 12-24 words';
        },
      },
      {
        onCancel: () => {
          console.log(chalk.yellow('\n⚠️  Test cancelled.'));
          return false; // Continue with other tests
        },
      }
    );

    if (!mnemonicResponse.mnemonic) {
      console.log(chalk.yellow('⚠️  No mnemonic provided, test cancelled'));
      return false;
    }

    // Test the specific recovery method by unlocking with it
    await client.cryptoManager.unlockWithRecovery(mnemonicResponse.mnemonic.trim(), wrappedSeed);
    console.log(chalk.green('✅ Recovery unlock method test successful'));
    console.log(chalk.white('   Recovery mnemonic was correct and keychain unlocked'));
    return true;
  } catch (error) {
    console.error(chalk.red('❌ Recovery unlock test failed:'), error.message);
    if (context.flags.debug) {
      console.error(error);
    }
    return false;
  }
}

async function recoveryCommand(context) {
  try {
    // Create password provider for keychain operations
    const passwordProvider = {
      async getPassword(promptText) {
        console.log(chalk.blue('🔐 Keychain password required'));

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

    // Parse word count from flags (default to 24)
    let wordCount = 24;
    if (context.flags.words) {
      const requestedWords = parseInt(context.flags.words, 10);
      if ([12, 15, 18, 21, 24].includes(requestedWords)) {
        wordCount = requestedWords;
      } else {
        console.error(chalk.red('❌ Invalid word count. Must be 12, 15, 18, 21, or 24'));
        process.exit(1);
      }
    }

    // Resolve API base URL with fallback logic: flag -> config -> production default
    const apiBaseUrl = resolveApiBaseUrl(context.flags.apiUrl, context.flags.debug);

    console.log(chalk.white('🔐 Initializing Ident SDK...'));

    // Create SDK client instance
    const client = IdentClient.create({
      apiBaseUrl,
      clientId: 'ident-cli',
      scopes: ['user', 'vault.read', 'vault.write', 'vault.decrypt'],
      passwordProvider,
      deviceKeyProvider: createDeviceKeyProvider(),
      sshKeyProvider: createSSHKeyProvider(context.flags.sshKey),
      debug: context.flags.debug,
    });

    await client.ready();
    console.log('[CLI] Client ready');

    // Add unlock method selection handler
    console.log('[CLI] Setting up unlock_method_selection handler');
    client.on('unlock_method_selection', (data) => {
      console.log('[CLI] Received unlock_method_selection event');
      const { methods, resolve, reject } = data;

      console.log(chalk.blue('🔐 Multiple unlock methods available. Choose one:'));
      methods.forEach((method, index) => {
        const displayText = method.detail
          ? `${method.displayName} ${chalk.gray(`(${method.detail})`)}`
          : method.displayName;
        console.log(chalk.white(`   ${index + 1}. ${displayText}`));
      });

      prompts(
        {
          type: 'number',
          name: 'choice',
          message: `Select unlock method (1-${methods.length}):`,
          min: 1,
          max: methods.length,
          validate: (value) => {
            if (!value || value < 1 || value > methods.length) {
              return `Please enter a number between 1 and ${methods.length}`;
            }
            return true;
          },
        },
        {
          onCancel: () => {
            console.log(chalk.yellow('\n⚠️  Operation cancelled.'));
            process.exit(1);
          },
        }
      )
        .then((response) => {
          if (!response.choice) {
            reject(new Error('No unlock method selected'));
          } else {
            const selectedMethod = methods[response.choice - 1];
            console.log(chalk.white(`✅ Selected: ${selectedMethod.displayName}`));
            resolve(selectedMethod.id);
          }
        })
        .catch((error) => {
          reject(error);
        });
    });

    // Check if authenticated
    const session = client.getSession();
    if (!session) {
      console.log(chalk.yellow('⚠️  Not authenticated. Run login first.'));
      console.log(chalk.white(`   ${context.personality} auth login`));
      process.exit(1);
    }

    console.log(chalk.white('👤 Current session:'));
    console.log(chalk.white(`   Subject: ${session.subject.id}`));
    console.log(chalk.white(`   Word count: ${wordCount} words`));
    console.log('');

    let result;

    // Check if user wants to import an existing mnemonic
    if (context.flags.import) {
      console.log(chalk.blue('📥 Importing existing recovery mnemonic...'));
      console.log(chalk.yellow('⚠️  This will add your existing mnemonic as a recovery method'));
      console.log(chalk.white('   Make sure your mnemonic is from a trusted source'));
      console.log('');

      // Get the existing mnemonic from user
      const mnemonicResponse = await prompts(
        {
          type: 'text',
          name: 'mnemonic',
          message: 'Enter your existing recovery mnemonic (12-24 words):',
          validate: (value) => {
            const words = value.trim().split(/\s+/);
            if (words.length < 12 || words.length > 24) {
              return 'Mnemonic must be 12-24 words';
            }

            // Check if word count matches expected patterns (12, 15, 18, 21, 24)
            if (![12, 15, 18, 21, 24].includes(words.length)) {
              return 'Mnemonic must have exactly 12, 15, 18, 21, or 24 words';
            }

            return true;
          },
        },
        {
          onCancel: () => {
            console.log(chalk.yellow('\n⚠️  Operation cancelled.'));
            process.exit(1);
          },
        }
      );

      if (!mnemonicResponse.mnemonic) {
        console.log(chalk.yellow('⚠️  No mnemonic provided, aborting.'));
        process.exit(1);
      }

      const mnemonic = mnemonicResponse.mnemonic.trim();
      const actualWordCount = mnemonic.split(/\s+/).length;

      // Import the existing mnemonic
      result = await client.addRecoveryMethod({
        wordCount: actualWordCount,
        importMnemonic: mnemonic,
      });

      console.log(chalk.green('✅ Recovery mnemonic imported successfully!'));
    } else {
      console.log(chalk.blue('🔄 Generating recovery mnemonic...'));
      console.log(chalk.yellow('⚠️  This mnemonic allows complete access to your encrypted data'));
      console.log(chalk.white('   Make sure to store it securely and never share it'));
      console.log('');

      // Generate recovery method
      result = await client.addRecoveryMethod({ wordCount });

      console.log(chalk.green('✅ Recovery mnemonic generated successfully!'));
    }

    // Display mnemonic (for generated ones, or confirmation for imported ones)
    if (!context.flags.import) {
      console.log('');
      console.log(chalk.white('🔒 Your recovery mnemonic (write this down securely):'));
      console.log('');
      console.log(chalk.bgBlue.white(' ' + result.mnemonic + ' '));
      console.log('');
    } else {
      console.log('');
      console.log(chalk.white('🔒 Recovery method configured with your imported mnemonic'));
      console.log('');
    }

    // Ask user to confirm they've secured their mnemonic
    const confirmMessage = context.flags.import
      ? 'Confirm you have your recovery mnemonic securely stored?'
      : 'Have you securely written down your recovery mnemonic?';

    const confirmation = await prompts(
      {
        type: 'confirm',
        name: 'confirmed',
        message: confirmMessage,
        initial: false,
      },
      {
        onCancel: () => {
          console.log(chalk.yellow('\n⚠️  Operation cancelled.'));
          process.exit(1);
        },
      }
    );

    if (!confirmation.confirmed) {
      if (context.flags.import) {
        console.log(
          chalk.yellow(
            '⚠️  Please ensure your recovery mnemonic is securely stored before continuing'
          )
        );
        process.exit(1);
      } else {
        console.log(chalk.yellow('⚠️  Please write down your recovery mnemonic before continuing'));
        console.log(chalk.white('   Recovery mnemonic: ' + result.mnemonic));
        process.exit(1);
      }
    }

    console.log(chalk.green('✅ Recovery method added to keychain'));
    console.log('');
    console.log(chalk.blue('💡 Usage:'));
    console.log(chalk.gray(`   Test:   ${context.personality} keys test recovery`));
    console.log(chalk.gray(`   Remove: ${context.personality} keys remove recovery`));
    console.log('');
    console.log(chalk.red('⚠️  CRITICAL SECURITY REMINDERS:'));
    console.log(chalk.white('   • Store your mnemonic in a safe, offline location'));
    console.log(chalk.white('   • Never share your mnemonic with anyone'));
    console.log(chalk.white('   • Anyone with this mnemonic can access your encrypted data'));
    console.log(chalk.white('   • Consider using a password manager or physical backup'));
  } catch (error) {
    console.error(chalk.red('❌ Recovery method generation failed:'), error.message);
    if (context.flags.debug) {
      console.error(error);
    }
    process.exit(1);
  }
}

async function sshCommand(context) {
  // SSH command now directly adds an SSH key, like device and recovery commands
  try {
    // Create password provider for keychain operations
    const passwordProvider = {
      async getPassword(promptText) {
        console.log(chalk.blue('🔐 Keychain password required'));

        const response = await prompts({
          type: 'password',
          name: 'password',
          message: promptText,
          validate: (value) =>
            value.length >= 8 ? true : 'Password must be at least 8 characters',
        });

        if (!response.password) {
          throw new Error('Password is required for keychain operations');
        }

        return response.password;
      },
    };

    // Resolve API base URL with fallback logic: flag -> config -> production default
    const apiBaseUrl = resolveApiBaseUrl(context.flags.apiUrl, context.flags.debug);

    console.log(chalk.white('🔐 Initializing Ident SDK...'));

    // Create SDK client instance
    const client = IdentClient.create({
      apiBaseUrl,
      clientId: 'ident-cli',
      scopes: ['user', 'vault.read', 'vault.write', 'vault.decrypt'],
      passwordProvider,
      deviceKeyProvider: createDeviceKeyProvider(),
      sshKeyProvider: createSSHKeyProvider(context.flags.sshKey),
      debug: context.flags.debug,
    });

    await client.ready();

    // Check if authenticated
    const session = client.getSession();
    if (!session) {
      console.log(chalk.yellow('⚠️  Not authenticated. Run login first.'));
      console.log(chalk.white(`   ${context.personality} auth login`));
      process.exit(1);
    }

    console.log(chalk.white('👤 Current session:'));
    console.log(chalk.white(`   Subject: ${session.subject.id}`));

    // Add unlock method selection handler for SSH key addition
    client.on('unlock_method_selection', (data) => {
      const { methods, resolve, reject } = data;

      console.log(chalk.blue('🔐 Multiple unlock methods available. Choose one:'));
      methods.forEach((method, index) => {
        const displayText = method.detail
          ? `${method.displayName} ${chalk.gray(`(${method.detail})`)}`
          : method.displayName;
        console.log(chalk.white(`   ${index + 1}. ${displayText}`));
      });

      prompts(
        {
          type: 'number',
          name: 'choice',
          message: `Select unlock method (1-${methods.length}):`,
          min: 1,
          max: methods.length,
          validate: (value) => {
            if (!value || value < 1 || value > methods.length) {
              return `Please enter a number between 1 and ${methods.length}`;
            }
            return true;
          },
        },
        {
          onCancel: () => {
            console.log(chalk.yellow('\n⚠️  Operation cancelled.'));
            process.exit(1);
          },
        }
      )
        .then((response) => {
          if (!response.choice) {
            reject(new Error('No unlock method selected'));
          } else {
            const selectedMethod = methods[response.choice - 1];
            console.log(chalk.white(`✅ Selected: ${selectedMethod.displayName}`));
            resolve(selectedMethod.id);
          }
        })
        .catch((error) => {
          reject(error);
        });
    });

    // Get the public key path
    // If --ssh-key is provided, derive the public key path from it
    let publicKeyPath;
    if (context.flags.sshKey) {
      // Expand tilde and add .pub extension
      const privateKeyPath = context.flags.sshKey.replace(/^~/, os.homedir());
      publicKeyPath = privateKeyPath + '.pub';
    } else if (context.flags['public-key']) {
      publicKeyPath = context.flags['public-key'];
    } else {
      // Default to id_ed25519.pub
      publicKeyPath = path.join(os.homedir(), '.ssh', 'id_ed25519.pub');
    }

    console.log(chalk.white('🔑 SSH Key Information:'));
    console.log(chalk.white(`   Key path: ${publicKeyPath}`));

    // Check if file exists first
    try {
      await fs.access(publicKeyPath);
    } catch (error) {
      console.error(chalk.red(`❌ SSH public key not found at ${publicKeyPath}`));
      console.error(chalk.yellow('   Please specify a valid path with --public-key=PATH'));
      console.error(chalk.yellow('   Or generate a key with: ssh-keygen -t ed25519'));
      process.exit(1);
    }

    // Read the public key
    const publicKey = await fs.readFile(publicKeyPath, 'utf-8');

    // Parse the key to show info
    const keyParts = publicKey.trim().split(/\s+/);
    const keyType = keyParts[0];
    const comment = keyParts.length > 2 ? keyParts.slice(2).join(' ') : undefined;

    console.log(chalk.white(`   Key type: ${keyType}`));
    if (comment) {
      console.log(chalk.white(`   Comment: ${comment}`));
    }
    console.log('');

    // Ask for confirmation
    if (!context.flags.yes) {
      const confirmResponse = await prompts({
        type: 'confirm',
        name: 'confirm',
        message: `Add this SSH key as an unlock method for your keychain?`,
        initial: true,
      });

      if (!confirmResponse.confirm) {
        console.log(chalk.yellow('⚠️  Operation cancelled'));
        process.exit(0);
      }
    }

    console.log(chalk.blue('🔄 Adding SSH key as unlock method...'));

    let result;
    try {
      // Add the SSH key as an unlock method
      result = await client.addSSHKeyMethod(publicKey);
    } catch (error) {
      console.error(chalk.red('❌ Failed to add SSH key:'), error.message);
      if (context.flags.debug) {
        console.error('Full error:', error);
      }
      process.exit(1);
    }
    const fingerprint = result.params?.fingerprint_sha256 || 'unknown';
    console.log(chalk.green('✅ SSH key added successfully!'));
    console.log(chalk.gray(`  Fingerprint: ${fingerprint}`));
    console.log('');
    console.log(chalk.blue('💡 Usage:'));
    console.log(chalk.gray(`   Test:   ${context.personality} keys test ssh`));
    console.log(chalk.gray(`   Remove: ${context.personality} keys remove ssh`));
    console.log('');
    console.log(
      chalk.yellow('⚠️  Note: SSH key unlock will be available when you next unlock your keychain')
    );
  } catch (error) {
    console.error(chalk.red('❌ SSH key addition failed:'), error.message);
    if (context.flags.debug) {
      console.error(error);
    }
    process.exit(1);
  }
}
