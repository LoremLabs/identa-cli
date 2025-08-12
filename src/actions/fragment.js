import { IdentClient } from '../../../ident-agency-sdk/lib-js/index.js';
import chalk from 'chalk';
import prompts from 'prompts';
import config from '../lib/config.js';
import { resolveApiBaseUrl } from '../lib/api-url.js';

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
      // First password entry
      const response = await prompts({
        type: 'password',
        name: 'password',
        message: promptText,
        validate: (value) => (value.length >= 8 ? true : 'Password must be at least 8 characters'),
      });

      if (!response.password) {
        throw new Error('Password is required for keychain operations');
      }

      // Confirmation - only if this looks like initial setup (not unlock)
      if (promptText.toLowerCase().includes('create') || promptText.toLowerCase().includes('new')) {
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

  // Parse timeout from --timeout flag (in milliseconds)
  let timeoutMs;
  if (context.flags.timeout) {
    timeoutMs = parseInt(context.flags.timeout, 10);
    if (isNaN(timeoutMs) || timeoutMs <= 0) {
      console.error(
        chalk.red('❌ Invalid timeout value. Must be a positive number in milliseconds.')
      );
      process.exit(1);
    }
    if (context.flags.debug) {
      console.log(chalk.blue(`🔧 API timeout: ${timeoutMs}ms`));
    }
  }

  // Parse --no-retry flag (meow converts --no-retry to retry: false)
  const disableRetries = context.flags.retry === false;
  if (disableRetries && context.flags.debug) {
    console.log(chalk.blue('🔧 API retries disabled'));
  }

  // Resolve API base URL with fallback logic: flag -> config -> production default
  const apiBaseUrl = resolveApiBaseUrl(context.flags.apiUrl, context.flags.debug);

  // Create SDK client instance
  const client = IdentClient.create({
    apiBaseUrl,
    clientId: 'ident-cli',
    scopes: ['profile', 'vault.read', 'vault.write', 'vault.decrypt'],
    passwordProvider,
    debug: context.flags.debug,
  });

  // Configure timeout and retry settings if provided
  const retryOptions = {};

  if (timeoutMs) {
    retryOptions.timeout = timeoutMs;
    retryOptions.overallTimeout = Math.max(timeoutMs * 3, 60000); // At least 60 seconds for overall timeout
  }

  if (disableRetries) {
    retryOptions.maxRetries = 0;
  }

  if (Object.keys(retryOptions).length > 0) {
    client.setRetryOptions(retryOptions);
  }

  try {
    await client.ready();

    // For write operations, always require authentication (with current user scopes)
    if (subcommand !== 'get' && subcommand !== 'list') {
      await client.ensureAuthenticated();
    }
  } catch (error) {
    console.error(chalk.red('❌ Failed to initialize:'), error.message);
    process.exit(1);
  }

  switch (subcommand) {
    case 'get': {
      if (!path) {
        console.error(
          `Usage: ${context.personality} fragment get PATH [--subject=email:user@domain.com] [--timeout=30000] [--no-retry] [--api-url=URL]`
        );
        process.exit(1);
      }

      try {
        let subjectToUse = context.flags.subject;
        let usePublicAccess = false;

        // If no subject provided, try to determine what to do
        if (!subjectToUse) {
          // Check if we're authenticated
          const session = client.getSession();
          if (!session) {
            // Not authenticated - check if we have a last user to suggest
            if (config.has('lastUser')) {
              const lastUser = config.get('lastUser');
              console.log(chalk.yellow('⚠️  Not authenticated'));
              console.log(chalk.white(`   Try running: ${context.personality} login`));
              console.log(
                chalk.gray(
                  `   Or specify subject for public access: ${context.personality} fragment get ${path} --subject="${lastUser}"`
                )
              );
              process.exit(0);
            } else {
              // No last user - just suggest login or subject
              console.log(chalk.yellow('⚠️  Not authenticated'));
              console.log(chalk.white(`   Try running: ${context.personality} login`));
              console.log(
                chalk.gray(
                  `   Or specify subject for public access: ${context.personality} fragment get ${path} --subject="email:user@domain.com"`
                )
              );
              process.exit(0);
            }
          }
          // If we reach here, we're authenticated and can proceed with normal access
        } else {
          // Subject provided - use public access
          usePublicAccess = true;
        }

        if (usePublicAccess) {
          console.log(chalk.white(`🔍 Getting public fragment: ${path}`));
          console.log(chalk.gray(`   From subject: ${subjectToUse}`));
        } else {
          console.log(chalk.white(`🔍 Getting fragment: ${path}`));
        }

        if (context.flags.debug) {
          console.log(chalk.cyan('🐛 DEBUG MODE: Fetching raw fragment envelope...'));
          if (usePublicAccess) {
            console.log(chalk.yellow('   (Raw envelope not available in public access mode)'));
          } else {
            const rawFragment = await client.getRaw(path);
            if (rawFragment) {
              console.log(chalk.magenta('📦 RAW FRAGMENT ENVELOPE:'));
              console.log(chalk.gray('='.repeat(50)));
              console.log(JSON.stringify(rawFragment, null, 2));
              console.log(chalk.gray('='.repeat(50)));
            }
          }
        }

        let fragment;
        if (usePublicAccess) {
          fragment = await client.getPublic(path, subjectToUse);
        } else {
          fragment = await client.get(path);
        }

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
        console.error(
          `Usage: ${context.personality} fragment put PATH [VALUE] [--timeout=30000] [--no-retry] [--api-url=URL]`
        );
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
        console.error(
          `Usage: ${context.personality} fragment delete PATH [--timeout=30000] [--no-retry] [--api-url=URL]`
        );
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
      console.error(
        `  ${context.personality} fragment get PATH [--subject=email:user@domain.com] [--timeout=30000] [--no-retry] [--api-url=URL]`
      );
      console.error(
        `  ${context.personality} fragment put PATH [VALUE] [--timeout=30000] [--no-retry] [--api-url=URL]`
      );
      console.error(
        `  ${context.personality} fragment list [PREFIX] [--timeout=30000] [--no-retry] [--api-url=URL]`
      );
      console.error(`  ${context.personality} fragment delete PATH [--timeout=30000] [--no-retry] [--api-url=URL]`);
      console.error('');
      console.error('Flags:');
      console.error('  --subject   Subject for accessing public fragments (get command only)');
      console.error('  --timeout   API timeout in milliseconds (default: 30000)');
      console.error('  --no-retry  Disable automatic retries on network errors');
      console.error('  --api-url   API base URL (default: config or https://www.ident.agency)');
      console.error('  --debug     Enable debug output');
      process.exit(1);
    }
  }
};
