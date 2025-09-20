import chalk from 'chalk';
import config from '../lib/config.js';

export const description = 'Manage global config (set, get, list)';

export const exec = async (context) => {
  const [, subcommand, key = '', ...rest] = context.input;
  const value = rest.join(' ');

  if (context.flags.debug) {
    console.log(
      chalk.blue(`Running config command: ${subcommand} ${key} ${value} ${context.personality}`)
    );
    console.log(chalk.gray(`ℹ️  Config path: ${config.path}`));
  }

  switch (subcommand) {
    case 'set': {
      if (!key || !value) {
        console.error(`Usage: ${context.personality} config set KEY VALUE`);
        process.exit(1);
      }
      config.set(key, value);
      console.log(chalk.green(`✅ Set ${key} in global config`));
      break;
    }

    case 'get': {
      if (!key) {
        console.error(`Usage: ${context.personality} config get KEY`);
        process.exit(1);
      }
      const result = config.get(key);
      if (result !== undefined) {
        console.log(result);
      } else {
        console.warn(chalk.yellow(`No value set for ${key}`));
      }
      break;
    }

    case 'list': {
      console.log(chalk.blue('Global config:'));
      for (const [k, v] of Object.entries(config.store)) {
        console.log(`${k}=${v}`);
      }
      break;
    }

    case 'delete': {
      if (!key) {
        console.error(`Usage: ${context.personality} config delete KEY`);
        process.exit(1);
      }
      if (config.has(key)) {
        config.delete(key);
        console.log(chalk.green(`✅ Deleted ${key} from global config`));
      } else {
        console.warn(chalk.yellow(`No value set for ${key}`));
      }
      break;
    }

    default: {
      console.error('Usage:');
      console.error(`  ${context.personality} config set KEY VALUE`);
      console.error(`  ${context.personality} config get KEY`);
      console.error(`  ${context.personality} config list`);
      console.error(`  ${context.personality} config delete KEY`);
      process.exit(1);
    }
  }
};
