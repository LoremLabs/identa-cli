import chalk from 'chalk';
import colorize from 'json-colorizer';
import prompts from 'prompts';
import { waitFor } from '../lib/wait.js';

const log = console.log;

const colorJson = (obj) => {
  return colorize(obj, { pretty: true });
};

const exec = async (context) => {
  let subcommand = context.input[1];

  if (!subcommand) {
    console.log('ok');
    process.exit(0);
  } else {
    const result = await prompts({
      type: 'select',
      name: 'value',
      message: 'Task ?',
      choices: [
        { title: 'This', value: 'this', selected: true },
        { title: 'that', value: 'that', selected: false },
        { title: 'Quit', value: 'quit' },
      ],
      // hint: "- Space to select. Return to submit",
    });

    if (result.value === 'quit') {
      process.exit(0);
    }
    subcommand = result.value;
  }

  try {
    switch (subcommand) {
      case 'this': {
        const resp = {
          date: new Date().toISOString(),
        };
        console.log(`this`, colorJson(resp));
        break;
      }
      case 'that': {
        const waitPromise = new Promise((resolve) => {
          setTimeout(() => {
            resolve('done');
          }, 3000);
        });
        const width = process.stdout?.columns || 80;
        // draw a line
        const line = '-'.repeat(Math.max(10, width - 10));
        log(chalk.blue(line));
        await waitFor(waitPromise, {
          text: `Waiting...`,
        });

        const resp = {
          date: new Date().toISOString(),
        };

        console.log(`that`, colorJson(resp));
        break;
      }
      case 'quit': {
        break;
      }
      default: {
        if (context.input[1] && context.input[1] !== 'help') {
          log(chalk.red(`Unknown command: ${context.input[1]}`));
        }
        log('');
        log('Usage: [command]');
        log('');
        log('commands: { help }');

        break;
      }
    }
  } catch (err) {
    console.log(err);
  }
};

export { exec };
