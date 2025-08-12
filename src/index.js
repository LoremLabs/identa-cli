import { setContextFunctions, setFlagDefaults } from './lib/env.js';

import chalk from 'chalk';
import { loadActions } from './actions/index.js'; // add new top level actions here

const log = console.log;

const actions = await loadActions();

// call the action with the given name
const appCli = async (commandInput) => {
  const { action, flags, input, version } = commandInput;
  flags.debug && log(chalk.green(JSON.stringify({ action, flags, input })));

  if (flags.version) {
    // show the version and exit
    log(`ident-cli version: ${version}`);
    process.exit(0);
  }
  if (flags.debug) {
    log(chalk.green(`debug mode on`));
    log(chalk.green(`version: ${version} action: ${action}`));
    log(chalk.green(`commandInput: ${JSON.stringify(commandInput, null)}`));
    log(chalk.green(`context: ${JSON.stringify(commandInput, null, 2)}`));
  }

  if (Object.prototype.hasOwnProperty.call(actions, action)) {
    const context = { ...commandInput };

    setContextFunctions(context);
    setFlagDefaults(context); // allow flag defaults to be set from ENV
    actions[action].exec(context);
  } else {
    log(chalk.red(`action ${action} not found`));
    process.exit(1);
  }
};

export default appCli;
