import { IdentClient } from '../../../ident-agency-sdk/lib-js/index.js';
import chalk from 'chalk';
import config from '../lib/config.js';
import prompts from 'prompts';
import { resolveApiBaseUrl } from '../lib/api-url.js';

export const description = 'Login to Ident.Agency using OAuth2/PKCE flow';

export const help = `
Usage:
  $ identa login [flags]

Flags:
  --scope     Custom scopes to request (space-separated)
  --timeout   Authentication timeout in seconds (default: 120)
  --api-url   API base URL (default: config or https://www.ident.agency)
  --debug     Enable debug output

Description:
  Authenticates with Ident.Agency using OAuth2/PKCE flow.
  
  By default, requests 'user' scope which expands to permissions
  needed for normal user activities. You can specify custom scopes with --scope.

Examples:
  # Default login with user scope
  $ identa login
  
  # Login with custom scopes
  $ identa login --scope "vault.read timeline"
  
  # Login with custom timeout (60 seconds)
  $ identa login --timeout 60
  
  # Login with development server
  $ identa login --api-url http://localhost:5173
  
  # Login with debug information
  $ identa login --debug
`;

export const exec = async (context) => {
  const [cmd] = context.input;

  if (context.flags.debug) {
    console.log(chalk.blue(`Running login command`));
  }

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
};
