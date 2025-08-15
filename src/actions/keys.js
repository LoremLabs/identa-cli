import { IdentClient } from '../../../ident-agency-sdk/lib-js/index.js';
import chalk from 'chalk';
import config from '../lib/config.js';
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
    
    default: {
      console.error('Usage:');
      console.error(`  ${context.personality} keys register [--api-url=URL] [--debug]`);
      console.error(`  ${context.personality} keys list [--api-url=URL] [--debug]`);
      console.error(`  ${context.personality} keys remove METHOD [KEY_ID] [--api-url=URL] [--debug]`);
      console.error(`  ${context.personality} keys test METHOD [KEY_ID] [--api-url=URL] [--debug]`);
      console.error('');
      console.error('Commands:');
      console.error('  register   Register a new authentication key (passkey via browser)');
      console.error('  list       List available authentication keys in keychain');
      console.error('  remove     Remove an authentication key from keychain');
      console.error('  test       Test an authentication key (password only in CLI)');
      console.error('');
      console.error('Global Flags:');
      console.error('  --api-url  API base URL (default: config or https://www.ident.agency)');
      console.error('  --debug    Enable debug output');
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
    });

    console.log(chalk.white('🔐 Initializing Ident SDK...'));
    await client.ready();

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
                      method.method === 'recovery' ? '🔄' : '❓';
          
          console.log(chalk.white(`   ${index + 1}. ${icon} ${method.method}`));
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
    });

    console.log(chalk.white('🔐 Initializing Ident SDK...'));
    await client.ready();

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
      const icon = m.method === 'password' ? '🔒' : m.method.startsWith('passkey') ? '🔑' : '❓';
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

    // Warning about removing all methods
    if (detailedMethods.length === 1) {
      console.log(chalk.red('⚠️  WARNING: This is your last unlock method!'));
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
  const [method, keyId] = context.input.slice(2);
  
  if (!method) {
    console.error(`Usage: ${context.personality} keys test METHOD [KEY_ID]`);
    console.error('Examples:');
    console.error(`  ${context.personality} keys test password password:v1`);
    console.error(`  ${context.personality} keys test passkey-prf passkey-prf:abc123`);
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
      scopes: ['user', 'vault.read', 'vault.decrypt'],
      passwordProvider,
    });

    console.log(chalk.white('🔐 Initializing Ident SDK...'));
    await client.ready();

    // Check if authenticated
    const session = client.getSession();
    if (!session) {
      console.log(chalk.yellow('⚠️  Not authenticated. Run login first.'));
      console.log(chalk.white(`   ${context.personality} auth login`));
      process.exit(1);
    }

    // Check if method is supported in CLI
    if (method.startsWith('passkey')) {
      console.error(chalk.red('❌ Passkey testing is not available in CLI'));
      console.error(chalk.white('   Passkeys require a browser environment with WebAuthn support'));
      console.error(chalk.white('   Use the web interface to test passkeys:'));
      console.error(chalk.white(`   ${apiBaseUrl}/example`));
      process.exit(1);
    }

    if (method !== 'password') {
      console.error(chalk.red(`❌ Testing method '${method}' is not supported in CLI`));
      console.error(chalk.white('   Only password testing is supported in CLI'));
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
    
    // For password, we just verify we can get the keychain info (which will prompt for password)
    const unlockInfo = await client.getUnlockMethods();
    
    if (unlockInfo.isUnlocked) {
      console.log(chalk.green('✅ Unlock method test successful'));
      console.log(chalk.white('   Keychain is unlocked and accessible'));
    } else {
      console.log(chalk.yellow('⚠️  Keychain is locked - unlock method test could not complete'));
    }

  } catch (error) {
    console.error(chalk.red('❌ Failed to test unlock method:'), error.message);
    if (context.flags.debug) {
      console.error(error);
    }
    process.exit(1);
  }
}