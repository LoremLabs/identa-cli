import { IdentClient } from '../../../ident-agency-sdk/lib-js/index.js';
import chalk from 'chalk';
import prompts from 'prompts';

export const description = 'Manage fragments (get, put, list, delete)';

export const exec = async (context) => {
  const [cmd, subcommand, path, ...rest] = context.input;
  const value = rest.join(' ');

  if (context.flags.debug) {
    console.log(chalk.blue(`Running fragment command: ${subcommand} ${path} ${value}`));
  }

  // Create password provider for keychain operations
  const passwordProvider = {
    async getPassword(promptText) {
      const response = await prompts({
        type: 'password',
        name: 'password',
        message: promptText,
        validate: (value) => (value.length >= 8 ? true : 'Password must be at least 8 characters'),
      });

      if (!response.password) {
        throw new Error('Password is required for keychain operations');
      }

      return response.password;
    },
  };

  // Create SDK client instance
  const client = IdentClient.create({
    apiBaseUrl: 'http://localhost:5173', // Development server
    clientId: 'ident-cli',
    scopes: ['profile', 'vault.read', 'vault.write', 'vault.decrypt'],
    passwordProvider,
    debug: context.flags.debug,
  });

  try {
    await client.ready();
    await client.ensureAuthenticated(['vault.read', 'vault.write', 'vault.decrypt']);
  } catch (error) {
    console.error(chalk.red('❌ Authentication failed:'), error.message);
    console.log(chalk.white(`   Try running: ${context.personality} login`));
    process.exit(1);
  }

  switch (subcommand) {
    case 'get': {
      if (!path) {
        console.error(`Usage: ${context.personality} fragment get PATH`);
        process.exit(1);
      }

      try {
        console.log(chalk.white(`🔍 Getting fragment: ${path}`));

        if (context.flags.debug) {
          // In debug mode, show raw fragment envelope + decrypted content
          console.log(chalk.cyan('🐛 DEBUG MODE: Fetching raw fragment envelope...'));

          const rawFragment = await client.getRaw(path);
          if (rawFragment) {
            console.log(chalk.magenta('📦 RAW FRAGMENT ENVELOPE:'));
            console.log(chalk.gray('='.repeat(50)));
            console.log(JSON.stringify(rawFragment, null, 2));
            console.log(chalk.gray('='.repeat(50)));
          }
        }

        const fragment = await client.get(path);

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
        console.error(`Usage: ${context.personality} fragment put PATH [VALUE]`);
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
        // Prompt for value
        const response = await prompts({
          type: 'text',
          name: 'data',
          message: `Enter value for fragment ${path} (JSON or string):`,
        });

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

      // Ask for visibility
      const visibilityResponse = await prompts({
        type: 'select',
        name: 'visibility',
        message: 'Fragment visibility:',
        choices: [
          { title: 'Private (encrypted)', value: 'private' },
          { title: 'Public (plaintext)', value: 'public' },
        ],
        initial: 0,
      });

      try {
        console.log(chalk.white(`💾 Storing ${visibilityResponse.visibility} fragment: ${path}`));
        await client.put(path, data, {
          visibility: visibilityResponse.visibility,
        });
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

    case 'list': {
      const prefix = path || '';

      try {
        console.log(chalk.white(`📋 Listing fragments${prefix ? ` with prefix: ${prefix}` : ''}`));
        const fragments = await client.list(prefix);

        if (fragments && fragments.length > 0) {
          console.log(chalk.green(`✅ Found ${fragments.length} fragment(s):`));
          fragments.forEach((fragment, index) => {
            console.log(`${index + 1}. ${fragment.path} (${fragment.visibility || 'unknown'})`);
            if (fragment.metadata) {
              console.log(`   Created: ${fragment.metadata.createdAt || 'unknown'}`);
              console.log(`   Size: ${fragment.metadata.size || 'unknown'} bytes`);
            }

            if (context.flags.debug) {
              console.log(chalk.cyan(`🐛 DEBUG - Raw fragment ${index + 1}:`));
              console.log(chalk.gray('-'.repeat(30)));
              console.log(JSON.stringify(fragment, null, 2));
              console.log(chalk.gray('-'.repeat(30)));
            }
          });
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
        console.error(`Usage: ${context.personality} fragment delete PATH`);
        process.exit(1);
      }

      // Confirm deletion
      const confirmResponse = await prompts({
        type: 'confirm',
        name: 'confirm',
        message: `Are you sure you want to delete fragment: ${path}?`,
        initial: false,
      });

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

    default: {
      console.error('Usage:');
      console.error(`  ${context.personality} fragment get PATH`);
      console.error(`  ${context.personality} fragment put PATH [VALUE]`);
      console.error(`  ${context.personality} fragment list [PREFIX]`);
      console.error(`  ${context.personality} fragment delete PATH`);
      process.exit(1);
    }
  }
};
