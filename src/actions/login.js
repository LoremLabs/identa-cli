import chalk from 'chalk';
import prompts from 'prompts';
import { IdentClient } from '../../../ident-agency-sdk/lib-js/index.js';

export const description = 'Login to Ident.Agency using OAuth2/PKCE flow';

export const exec = async (context) => {
  const [cmd] = context.input;

  if (context.flags.debug) {
    console.log(chalk.blue(`Running login command`));
  }

  try {
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

    console.log(chalk.white('🌐 Starting OAuth2/PKCE authentication...'));
    await client.ensureAuthenticated(['profile', 'vault.read', 'vault.write', 'vault.decrypt']);

    // Get current session info
    const session = client.getSession();
    if (session) {
      console.log(chalk.green('✅ Successfully authenticated!'));
      console.log(chalk.white(`   Subject: ${session.subject.id}`));
      console.log(chalk.white(`   Scopes: ${session.scopes.join(', ')}`));
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