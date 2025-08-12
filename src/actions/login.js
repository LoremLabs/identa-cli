import chalk from 'chalk';
import prompts from 'prompts';
import config from '../lib/config.js';
import { IdentClient } from '../../../ident-agency-sdk/lib-js/index.js';

export const description = 'Login to Ident.Agency using OAuth2/PKCE flow';

export const help = `
Usage:
  $ identa login [flags]

Flags:
  --scope    Custom scopes to request (space-separated)
  --debug    Enable debug output

Description:
  Authenticates with Ident.Agency using OAuth2/PKCE flow.
  
  By default, requests 'user' scope which expands to permissions
  needed for normal user activities. You can specify custom scopes with --scope.

Examples:
  # Default login with user scope
  $ identa login
  
  # Login with custom scopes
  $ identa login --scope "vault.read timeline"
  
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
      requestedScopes = context.flags.scope.split(' ').filter(s => s.trim());
      if (context.flags.debug) {
        console.log(chalk.blue(`🔧 Custom scopes requested: ${requestedScopes.join(', ')}`));
      }
    }

    // Create password provider for keychain setup
    const passwordProvider = {
      async getPassword(promptText) {
        console.log(chalk.blue('🔐 Keychain setup required'));
        
        const response = await prompts({
          type: 'password',
          name: 'password',
          message: promptText,
          validate: value => value.length >= 8 ? true : 'Password must be at least 8 characters'
        });
        
        if (!response.password) {
          throw new Error('Password is required for keychain setup');
        }
        
        return response.password;
      }
    };

    // Create SDK client instance  
    const client = IdentClient.create({
      apiBaseUrl: 'http://localhost:5173', // Development server
      clientId: 'ident-cli', // CLI client ID
      scopes: ['profile', 'vault.read', 'vault.write', 'vault.decrypt'],
      passwordProvider
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
    await client.ensureAuthenticated(scopesToRequest);

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