import chalk from 'chalk';
import prompts from 'prompts';
import { IdentClient } from '../../../ident-agency-sdk/lib-js/index.js';

export const description = 'Test the Ident SDK end-to-end (login, store, retrieve, list)';

export const exec = async (context) => {
  const [cmd] = context.input;

  if (context.flags.debug) {
    console.log(chalk.blue('Running SDK end-to-end test'));
  }

  try {
    console.log(chalk.white('🧪 Starting Ident SDK end-to-end test...'));
    console.log();

    // Step 1: Initialize SDK
    console.log(chalk.white('1️⃣  Initializing SDK...'));

    // Create password provider for CLI
    const passwordProvider = {
      async getPassword(promptText) {
        if (context.flags.automated) {
          // Use test password for automated runs
          console.log(chalk.gray('   Using automated test password'));
          return 'automated-test-password-123';
        }

        // First password entry
        const response = await prompts({
          type: 'password',
          name: 'password',
          message: promptText,
          validate: (value) =>
            value.length >= 8 ? true : 'Password must be at least 8 characters',
        });

        if (!response.password) {
          throw new Error('Password is required');
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

    const client = IdentClient.create({
      apiBaseUrl: 'http://localhost:5173', // Development server
      clientId: 'ident-cli',
      scopes: ['profile', 'vault.read', 'vault.write', 'vault.decrypt'],
      passwordProvider,
    });

    await client.ready();
    console.log(chalk.green('✅ SDK initialized'));
    console.log();

    // Step 2: Authenticate
    console.log(chalk.white('2️⃣  Authenticating...'));
    await client.ensureAuthenticated(['profile', 'vault.read', 'vault.write', 'vault.decrypt']);

    const session = client.getSession();
    if (session) {
      console.log(chalk.green('✅ Authentication successful'));
      console.log(chalk.white(`   Subject: ${session.subject.id}`));
      console.log(chalk.white(`   Scopes: ${session.scopes.join(', ')}`));
    } else {
      throw new Error('Authentication succeeded but no session found');
    }
    console.log();

    // Step 3: Store test fragments
    const testFragments = [
      { path: 'test/sdk/public-string', data: 'Hello from CLI!', visibility: 'public' },
      {
        path: 'test/sdk/private-object',
        data: { message: 'Secret data', timestamp: Date.now() },
        visibility: 'private',
      },
      { path: 'test/sdk/public-number', data: 42, visibility: 'public' },
    ];

    console.log(chalk.white('3️⃣  Storing test fragments...'));
    for (const fragment of testFragments) {
      console.log(chalk.white(`   📝 Storing ${fragment.visibility}: ${fragment.path}`));
      await client.put(fragment.path, fragment.data, { visibility: fragment.visibility });
    }
    console.log(chalk.green('✅ All test fragments stored'));
    console.log();

    // Step 4: Retrieve test fragments
    console.log(chalk.white('4️⃣  Retrieving test fragments...'));
    for (const fragment of testFragments) {
      console.log(chalk.white(`   🔍 Getting: ${fragment.path}`));
      const retrieved = await client.get(fragment.path);

      if (JSON.stringify(retrieved) === JSON.stringify(fragment.data)) {
        console.log(chalk.green(`   ✅ Match: ${fragment.path}`));
      } else {
        console.log(chalk.red(`   ❌ Mismatch: ${fragment.path}`));
        console.log(chalk.white(`      Expected: ${JSON.stringify(fragment.data)}`));
        console.log(chalk.white(`      Got: ${JSON.stringify(retrieved)}`));
      }
    }
    console.log();

    // Step 5: List fragments
    console.log(chalk.white('5️⃣  Listing fragments under test/sdk/...'));
    const fragments = await client.list('test/sdk/');
    console.log(chalk.green(`✅ Found ${fragments.length} fragment(s):`));
    fragments.forEach((fragment, index) => {
      console.log(
        chalk.white(`   ${index + 1}. ${fragment.path} (${fragment.visibility || 'unknown'})`)
      );
    });
    console.log();

    // Step 6: Clean up test fragments
    console.log(chalk.white('6️⃣  Cleaning up test fragments...'));
    for (const fragment of testFragments) {
      console.log(chalk.white(`   🗑️  Deleting: ${fragment.path}`));
      await client.del(fragment.path);
    }
    console.log(chalk.green('✅ Test fragments cleaned up'));
    console.log();

    console.log(chalk.green('🎉 End-to-end test completed successfully!'));
    console.log(chalk.white('All SDK functionality is working correctly.'));
  } catch (error) {
    console.error(chalk.red('❌ Test failed:'), error.message);
    if (context.flags.debug) {
      console.error(error);
    }
    process.exit(1);
  }
};
