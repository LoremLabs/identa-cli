import chalk from 'chalk';
import getStdin from 'get-stdin';

const log = console.log;

export const exec = async (context) => {
  const input = await getStdin();

  // context contains the flags and input

  if (!context.flags.quiet) {
    log(`via: ${context.personality}\n`);
    log(
      chalk.white(JSON.stringify({ ...context, stdin: input, env: { ...process.env } }, null, 2))
    );
  }
};

export const description = 'hello world example in javascript';
