import chalk from 'chalk';
import prompts from 'prompts';
import config from '../lib/config.js';
import { IdentClient } from '../../../ident-agency-sdk/lib-js/index.js';

export const description = 'Logout from Ident.Agency and clear stored session';

export const help = `
Usage:
  $ identa logout [flags]

Flags:
  --force    Skip confirmation prompt and logout immediately
  --debug    Enable debug output

Description:
  Logs out from Ident.Agency by clearing the stored session and keychain cache.
  This will require you to login again before accessing private fragments.
  
  By default, you'll be prompted to confirm the logout. Use --force to skip
  the confirmation prompt, which is useful for automation or scripts.

Examples:
  # Interactive logout with confirmation
  $ identa logout
  
  # Force logout without confirmation  
  $ identa logout --force
  
  # Logout with debug information
  $ identa logout --debug
`;

export const exec = async (context) => {
  const [cmd] = context.input;

  if (context.flags.debug) {
    console.log(chalk.blue(`Running logout command`));
  }

  try {
    // Create SDK client instance (no need for password provider for logout)
    const client = IdentClient.create({
      apiBaseUrl: 'http://localhost:5173', // Development server
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
    console.log(chalk.gray('   Use "identa login" to authenticate again'));
  } catch (error) {
    console.error(chalk.red('❌ Logout failed:'), error.message);
    if (context.flags.debug) {
      console.error(error);
    }
    process.exit(1);
  }
};
