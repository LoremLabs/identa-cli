import { IdentClient } from '../../../ident-agency-sdk/lib-js/index.js';
import chalk from 'chalk';
import config from '../lib/config.js';
import prompts from 'prompts';
import { resolveApiBaseUrl } from '../lib/api-url.js';

export const description = 'Authentication commands (login, logout, profile)';

export const exec = async (context) => {
  const [cmd, subcommand, ...rest] = context.input;

  if (context.flags.debug) {
    console.log(chalk.blue(`Running auth command: ${subcommand}`));
  }

  switch (subcommand) {
    case 'login': {
      await loginCommand(context);
      break;
    }
    
    case 'logout': {
      await logoutCommand(context);
      break;
    }
    
    case 'profile': {
      await profileCommand(context);
      break;
    }
    
    default: {
      console.error('Usage:');
      console.error(`  ${context.personality} auth login [--scope="user"] [--timeout=120] [--api-url=URL]`);
      console.error(`  ${context.personality} auth logout [--debug]`);
      console.error(`  ${context.personality} auth profile [--api-url=URL] [--debug]`);
      console.error('');
      console.error('Commands:');
      console.error('  login    Authenticate with Ident.Agency using OAuth2/PKCE flow');
      console.error('  logout   Clear authentication session and keychain');
      console.error('  profile  Show current user profile and session information');
      console.error('');
      console.error('Global Flags:');
      console.error('  --api-url  API base URL (default: config or https://www.ident.agency)');
      console.error('  --debug    Enable debug output');
      process.exit(1);
    }
  }
};

async function loginCommand(context) {
  try {
    // Parse custom scopes from --scope flag
    let requestedScopes;
    if (context.flags.scope) {
      // Split space-separated scopes
      requestedScopes = context.flags.scope.split(' ').filter((s) => s.trim());
      if (context.flags.debug) {
        console.log(chalk.blue(`🔧 Custom scopes requested: ${requestedScopes.join(', ')}`));
      }
    }

    // Parse timeout from --timeout flag (in seconds)
    let timeoutMs;
    if (context.flags.timeout) {
      const timeoutSeconds = parseInt(context.flags.timeout, 10);
      if (isNaN(timeoutSeconds) || timeoutSeconds <= 0) {
        console.error(chalk.red('❌ Invalid timeout value. Must be a positive number in seconds.'));
        process.exit(1);
      }
      timeoutMs = timeoutSeconds * 1000;
      if (context.flags.debug) {
        console.log(chalk.blue(`🔧 Custom timeout: ${timeoutSeconds} seconds`));
      }
    }

    // Create password provider for keychain setup
    const passwordProvider = {
      async getPassword(promptText) {
        console.log(chalk.blue('🔐 Keychain setup required'));

        // First password entry
        const response = await prompts({
          type: 'password',
          name: 'password',
          message: promptText,
          validate: (value) =>
            value.length >= 8 ? true : 'Password must be at least 8 characters',
        });

        if (!response.password) {
          throw new Error('Password is required for keychain setup');
        }

        // Confirmation - only if this looks like initial setup (not unlock)
        if (
          promptText.toLowerCase().includes('create') ||
          promptText.toLowerCase().includes('new')
        ) {
          const confirmResponse = await prompts({
            type: 'password',
            name: 'password',
            message: 'Confirm password:',
            validate: (value) => (value === response.password ? true : 'Passwords do not match'),
          });

          if (!confirmResponse.password) {
            throw new Error('Password confirmation is required');
          }
        }

        return response.password;
      },
    };

    // Resolve API base URL with fallback logic: flag -> config -> production default
    const apiBaseUrl = resolveApiBaseUrl(context.flags.apiUrl, context.flags.debug);

    // Create SDK client instance
    const client = IdentClient.create({
      apiBaseUrl,
      clientId: 'ident-cli', // CLI client ID
      scopes: ['user'],
      passwordProvider,
    });

    console.log(chalk.white('🔐 Initializing Ident SDK...'));
    await client.ready();

    // Determine which scopes to request
    let scopesToRequest;
    if (requestedScopes) {
      scopesToRequest = requestedScopes;
      if (context.flags.debug) {
        console.log(chalk.blue(`🔧 Using custom scopes: ${scopesToRequest.join(', ')}`));
      }
    } else {
      // Default scope is 'user' which expands to needed permissions for normal user activities
      scopesToRequest = ['user'];
      if (context.flags.debug) {
        console.log(chalk.blue(`🔧 Using default scope: ${scopesToRequest.join(', ')}`));
      }
    }

    console.log(chalk.white('🌐 Starting OAuth2/PKCE authentication...'));
    if (timeoutMs && context.flags.debug) {
      console.log(chalk.blue(`🔧 Authentication timeout: ${timeoutMs / 1000} seconds`));
    }
    await client.ensureAuthenticated(scopesToRequest, timeoutMs);

    // Get current session info
    const session = client.getSession();
    if (session) {
      console.log(chalk.green('✅ Successfully authenticated!'));
      console.log(chalk.white(`   Subject: ${session.subject.id}`));
      console.log(chalk.white(`   Subject Hash: ${session.subject.hash}`));
      console.log(chalk.white(`   Scopes: ${session.scopes.join(', ')}`));

      // Store the last logged-in user for future reference
      config.set('lastUser', session.subject.id);
      if (context.flags.debug) {
        console.log(chalk.blue(`🔧 Stored last user: ${session.subject.id}`));
      }
    } else {
      console.log(chalk.yellow('⚠️  Authentication completed but no session found'));
    }
  } catch (error) {
    console.error(chalk.red('❌ Login failed:'), error.message);
    if (context.flags.debug) {
      console.error(error);
    }
    process.exit(1);
  }
}

async function logoutCommand(context) {
  try {
    // Resolve API base URL with fallback logic: flag -> config -> production default
    const apiBaseUrl = resolveApiBaseUrl(context.flags.apiUrl, context.flags.debug);

    // Create SDK client instance (no need for password provider for logout)
    const client = IdentClient.create({
      apiBaseUrl,
      clientId: 'ident-cli', // CLI client ID
    });

    console.log(chalk.white('🔐 Initializing Ident SDK...'));
    await client.ready();

    // Check if user is currently authenticated
    const currentSession = client.getSession();
    if (!currentSession) {
      console.log(chalk.yellow('ℹ️  You are not currently logged in'));
      return;
    }

    // Show current session info before logout
    console.log(chalk.white('Current session:'));
    console.log(chalk.white(`  Subject: ${currentSession.subject.id}`));
    console.log(chalk.white(`  Scopes: ${currentSession.scopes.join(', ')}`));

    // Confirm logout unless --force flag is used
    if (!context.flags.force) {
      const response = await prompts({
        type: 'confirm',
        name: 'confirm',
        message: 'Are you sure you want to logout?',
        initial: false,
      });

      if (!response.confirm) {
        console.log(chalk.yellow('Logout cancelled'));
        return;
      }
    }

    // Clear the session
    console.log(chalk.white('🚪 Clearing session...'));

    // Access the session manager directly to clear session
    await client.sessionManager.clearSession();

    // Also clear keychain cache if it exists
    if (client.keychainCache) {
      client.keychainCache = null;
      if (context.flags.debug) {
        console.log(chalk.blue('🔧 Cleared keychain cache'));
      }
    }

    // Clear any access tokens
    client.apiClient.clearAccessToken?.();

    // Clear the last user from config
    if (config.has('lastUser')) {
      const lastUser = config.get('lastUser');
      config.delete('lastUser');
      if (context.flags.debug) {
        console.log(chalk.blue(`🔧 Cleared last user: ${lastUser}`));
      }
    }

    console.log(chalk.green('✅ Successfully logged out!'));
    console.log(chalk.white('   All session data has been cleared from local storage'));
    console.log(chalk.gray(`   Use "${context.personality} auth login" to authenticate again`));
  } catch (error) {
    console.error(chalk.red('❌ Logout failed:'), error.message);
    if (context.flags.debug) {
      console.error(error);
    }
    process.exit(1);
  }
}

async function profileCommand(context) {
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

        // Confirmation - only if this looks like initial setup (not unlock)
        if (
          promptText.toLowerCase().includes('create') ||
          promptText.toLowerCase().includes('new')
        ) {
          const confirmResponse = await prompts({
            type: 'password',
            name: 'password',
            message: 'Confirm password:',
            validate: (value) => (value === response.password ? true : 'Passwords do not match'),
          });

          if (!confirmResponse.password) {
            throw new Error('Password confirmation is required');
          }
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
      scopes: ['profile', 'vault.read', 'vault.write', 'vault.decrypt'],
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

    // Display session information
    console.log(chalk.green('👤 User Profile'));
    console.log(chalk.white(`   Subject ID: ${session.subject.id}`));
    console.log(chalk.white(`   Subject Hash: ${session.subject.hash}`));
    console.log(chalk.white(`   Scopes: ${session.scopes.join(', ')}`));
    console.log(chalk.white(`   Created: ${new Date(session.createdAt).toISOString()}`));

    if (session.expiresAt) {
      const isExpired = Date.now() >= session.expiresAt;
      const expiry = new Date(session.expiresAt).toISOString();
      console.log(
        chalk.white(
          `   Expires: ${expiry} ${isExpired ? chalk.red('(EXPIRED)') : chalk.green('(Valid)')}`
        )
      );
    } else {
      console.log(chalk.white(`   Expires: Never`));
    }

    console.log(chalk.white(`   Has Access Token: ${session.accessToken ? 'Yes' : 'No'}`));
    console.log(chalk.white(`   Has Refresh Token: ${session.refreshToken ? 'Yes' : 'No'}`));
  } catch (error) {
    console.error(chalk.red('❌ Failed to get profile:'), error.message);
    if (context.flags.debug) {
      console.error(error);
    }
    process.exit(1);
  }
}