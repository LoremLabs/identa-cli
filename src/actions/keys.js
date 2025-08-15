import { IdentClient } from '../../../ident-agency-sdk/lib-js/index.js';
import chalk from 'chalk';
import config from '../lib/config.js';
import prompts from 'prompts';
import { resolveApiBaseUrl } from '../lib/api-url.js';
import { getSecretProvider } from '../lib/secrets.js';
import { createHash, randomBytes } from 'crypto';
import os from 'os';

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
    
    default: {
      console.error('Usage:');
      console.error(`  ${context.personality} keys register [--api-url=URL] [--debug]`);
      console.error(`  ${context.personality} keys list [--api-url=URL] [--debug]`);
      console.error(`  ${context.personality} keys remove METHOD [KEY_ID] [--api-url=URL] [--debug] [--yes]`);
      console.error(`  ${context.personality} keys test [METHOD] [KEY_ID] [--api-url=URL] [--debug]`);
      console.error(`  ${context.personality} keys device [--api-url=URL] [--debug] [--yes]`);
      console.error('');
      console.error('Commands:');
      console.error('  register   Register a new authentication key (passkey via browser)');
      console.error('  list       List available authentication keys in keychain');
      console.error('  remove     Remove an authentication key from keychain');
      console.error('  test       Test an authentication key (password and device in CLI)');
      console.error('  device     Generate and register a device-specific unlock key');
      console.error('');
      console.error('Global Flags:');
      console.error('  --api-url  API base URL (default: config or https://www.ident.agency)');
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
      debug: context.flags.debug,
    });

    console.log(chalk.white('🔐 Initializing Ident SDK...'));
    await client.ready();

    // Add unlock method selection handler
    client.on('unlock_method_selection', (data) => {
      const { methods, resolve, reject } = data;
      
      console.log(chalk.blue('🔐 Multiple unlock methods available. Choose one:'));
      methods.forEach((method, index) => {
        console.log(chalk.white(`   ${index + 1}. ${method.displayName}`));
      });
      
      prompts({
        type: 'number',
        name: 'choice',
        message: 'Select unlock method',
        min: 1,
        max: methods.length,
        initial: 1
      }).then(answer => {
        const selectedMethod = methods[answer.choice - 1];
        resolve(selectedMethod.id);
      }).catch(reject);
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
        console.log(chalk.gray(`   Run "${context.personality} auth login" to initialize keychain`));
      } else {
        console.log(chalk.white(`   Available methods: ${detailedMethods.length}`));
        console.log('');
        
        detailedMethods.forEach((method, index) => {
          const icon = method.method === 'password' ? '🔒' : 
                      method.method.startsWith('passkey') ? '🔑' : 
                      method.method === 'recovery' ? '🔄' :
                      method.method === 'device' ? '💻' : '❓';
          
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
        console.log(chalk.gray(`   Remove: ${context.personality} keys remove password ${detailedMethods[0]?.keyId || 'KEY_ID'}`));
        console.log(chalk.gray(`   Test:   ${context.personality} keys test password ${detailedMethods[0]?.keyId || 'KEY_ID'}`));
      }

      // Show unlock status
      const unlockInfo = await client.getUnlockMethods();
      console.log(chalk.white(`   Status: ${unlockInfo.isUnlocked ? chalk.green('Unlocked') : chalk.yellow('Locked')}`));

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
      debug: context.flags.debug,
    });

    console.log(chalk.white('🔐 Initializing Ident SDK...'));
    await client.ready();

    // Add unlock method selection handler
    client.on('unlock_method_selection', (data) => {
      const { methods, resolve, reject } = data;
      
      console.log(chalk.blue('🔐 Multiple unlock methods available. Choose one:'));
      methods.forEach((method, index) => {
        console.log(chalk.white(`   ${index + 1}. ${method.displayName}`));
      });
      
      prompts({
        type: 'number',
        name: 'choice',
        message: 'Select unlock method',
        min: 1,
        max: methods.length,
        initial: 1
      }).then(answer => {
        const selectedMethod = methods[answer.choice - 1];
        resolve(selectedMethod.id);
      }).catch(reject);
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
      const icon = m.method === 'password' ? '🔒' : 
                  m.method.startsWith('passkey') ? '🔑' : 
                  m.method === 'device' ? '💻' : '❓';
      console.log(chalk.white(`   ${index + 1}. ${icon} ${m.method} (${m.keyId})`));
    });
    console.log('');

    // Find the method to remove
    let targetMethod = detailedMethods.find(m => m.method === method && (!keyId || m.keyId === keyId));
    
    if (!targetMethod && keyId) {
      // Try to find by keyId alone
      targetMethod = detailedMethods.find(m => m.keyId === keyId);
    }
    
    if (!targetMethod) {
      // Try to find by method type alone (if no keyId specified)
      const methodMatches = detailedMethods.filter(m => m.method === method);
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
      console.error(chalk.red(`❌ Unlock method not found: ${method}${keyId ? ` (${keyId})` : ''}`));
      process.exit(1);
    }

    // Confirm removal
    if (context.flags.yes) {
      console.log(chalk.white(`🗑️  --yes flag provided, removing ${targetMethod.method} (${targetMethod.keyId})`));
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

    console.log(chalk.white(`🗑️  Removing unlock method: ${targetMethod.method} (${targetMethod.keyId})`));
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
      debug: context.flags.debug,
    });

    console.log(chalk.white('🔐 Initializing Ident SDK...'));
    await client.ready();

    // Add unlock method selection handler
    client.on('unlock_method_selection', (data) => {
      const { methods, resolve, reject } = data;
      
      console.log(chalk.blue('🔐 Multiple unlock methods available. Choose one:'));
      methods.forEach((method, index) => {
        console.log(chalk.white(`   ${index + 1}. ${method.displayName}`));
      });
      
      prompts({
        type: 'number',
        name: 'choice',
        message: 'Select unlock method',
        min: 1,
        max: methods.length,
        initial: 1
      }).then(answer => {
        const selectedMethod = methods[answer.choice - 1];
        resolve(selectedMethod.id);
      }).catch(reject);
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
      const testableMethods = detailedMethods.filter(m => 
        m.method === 'password' || m.method === 'device'
      );

      if (testableMethods.length === 0) {
        console.log(chalk.yellow('⚠️  No CLI-testable unlock methods found'));
        console.log(chalk.white('   Only password and device methods can be tested in CLI'));
        console.log(chalk.white('   Use the web interface to test passkey methods'));
        process.exit(1);
      }

      console.log(chalk.green('🧪 Available unlock methods to test:'));
      
      // Create selection options
      const choices = testableMethods.map((method, index) => {
        const icon = method.method === 'password' ? '🔒' : 
                    method.method === 'device' ? '💻' : '❓';
        
        let displayName = `${icon} ${method.method}`;
        if (method.method === 'device' && method.device?.description) {
          displayName = `${icon} device - ${method.device.description}`;
        }
        
        return {
          title: `${displayName} (${method.keyId})`,
          value: { method: method.method, keyId: method.keyId }
        };
      });

      const selection = await prompts({
        type: 'select',
        name: 'selected',
        message: 'Which unlock method would you like to test?',
        choices: choices,
        initial: 0
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

    if (method !== 'password' && method !== 'device') {
      console.error(chalk.red(`❌ Testing method '${method}' is not supported in CLI`));
      console.error(chalk.white('   Only password and device testing is supported in CLI'));
      process.exit(1);
    }

    // Get available methods to find the target
    const detailedMethods = await client.getDetailedUnlockMethods();
    let targetMethod = detailedMethods.find(m => m.method === method && (!keyId || m.keyId === keyId));
    
    if (!targetMethod && keyId) {
      targetMethod = detailedMethods.find(m => m.keyId === keyId);
    }
    
    if (!targetMethod) {
      const methodMatches = detailedMethods.filter(m => m.method === method);
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
      console.error(chalk.red(`❌ Unlock method not found: ${method}${keyId ? ` (${keyId})` : ''}`));
      process.exit(1);
    }

    console.log(chalk.white(`🧪 Testing unlock method: ${targetMethod.method} (${targetMethod.keyId})`));
    
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
        const wrappedSeed = client.cryptoManager.wrappedSeeds.find(ws => ws.keyId === targetMethod.keyId);
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
    } else {
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
        const wrappedSeed = client.cryptoManager.wrappedSeeds.find(ws => ws.keyId === targetMethod.keyId);
        if (!wrappedSeed) {
          throw new Error(`WrappedSeed not found for keyId: ${targetMethod.keyId}`);
        }
        
        // If already unlocked, lock first to test properly
        if (client.cryptoManager.isUnlocked) {
          client.cryptoManager.lock();
          console.log(chalk.white('   Locked keychain to test password unlock'));
        }
        
        // Get the password from the provider
        const password = await client.config.passwordProvider.getPassword('Enter password to test unlock:');
        
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
      debug: context.flags.debug,
    });

    await client.ready();

    // Add unlock method selection handler
    client.on('unlock_method_selection', (data) => {
      const { methods, resolve, reject } = data;
      
      console.log(chalk.blue('🔐 Multiple unlock methods available. Choose one:'));
      methods.forEach((method, index) => {
        console.log(chalk.white(`   ${index + 1}. ${method.displayName}`));
      });
      
      prompts({
        type: 'number',
        name: 'choice',
        message: 'Select unlock method',
        min: 1,
        max: methods.length,
        initial: 1
      }).then(answer => {
        const selectedMethod = methods[answer.choice - 1];
        resolve(selectedMethod.id);
      }).catch(reject);
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
      initial: `${platform} Device`
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
      keyId: uniqueKeyId  // Use unique key ID to prevent replacement
    });

    console.log(chalk.green('✅ Device unlock method added to keychain'));
    console.log(chalk.white(`   Method ID: ${wrappedSeed.keyId}`));
    console.log(chalk.white(`   Keychain updated with device key wrapper`));
    console.log('');
    
    console.log(chalk.blue('💡 Usage:'));
    console.log(chalk.gray(`   Test:   ${context.personality} keys test device ${wrappedSeed.keyId}`));
    console.log(chalk.gray(`   Remove: ${context.personality} keys remove device ${wrappedSeed.keyId}`));
    console.log('');
    
    console.log(chalk.yellow('⚠️  Important: This device key is tied to this specific device'));
    console.log(chalk.white('   If you lose access to this device, you will need other unlock methods'));
    console.log(chalk.white('   Make sure you have password or passkey methods as backup'));

  } catch (error) {
    console.error(chalk.red('❌ Device key generation failed:'), error.message);
    if (context.flags.debug) {
      console.error(error);
    }
    process.exit(1);
  }
}