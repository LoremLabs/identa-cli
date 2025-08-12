import chalk from 'chalk';
import prompts from 'prompts';
import { IdentClient } from '../../../ident-agency-sdk/lib-js/client.js';
import { resolveApiBaseUrl } from '../lib/api-url.js';

export const description = 'Get current user profile and session information';

export const exec = async (context) => {
  const [cmd] = context.input;

  if (context.flags.debug) {
    console.log(chalk.blue(`Running profile command`));
  }

  try {
    // Create password provider for keychain operations
    const passwordProvider = {
      async getPassword(promptText) {
        // First password entry
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
      console.log(chalk.white(`   ${context.personality} login`));
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
};
