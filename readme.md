# Identa (Ident Agency CLI)

This CLI tool provides a common interface for interacting with the Indet Agency.

```bash
pnpm install
```

### Make the CLI globally available

To make the CLI globally available, you can use `pnpm link`:

```bash
pnpm link --global
```

## Usage

```bash
identa help
```

## List Commands

You can list all commands by running:

```bash
ident
```

## Config

You can set config options with:

```bash
identa config set <key> <value>
```

You can get config options with:

```bash
identa config get <key>
```

You can list all config options with:

```bash
identa config list
```

## Secrets

An example action "secrets" is provided to manage secrets. This allows you to store and retrieve secrets securely using the os secure enclave via keytar or GCP Secret Manager.

You can interface with a secret manager using the `identa secrets` command. Currently supported secret managers are:

- `local` - Local secret manager (OS keychain) [preferred for development]
- `gcp` - Google Cloud Secret Manager

You can set a secret with:

```bash
identa secrets set --service="$optionalKeyPrefix" <key> <value>
```

You can read a secret with:

```bash
identa secrets get --service="$optionalKeyPrefix" <key>
```

You can set the default secret manager with:

```bash
identa secrets provider <provider:local|gcp>
```

If you use GCP Secret Manager, you will be prompted to authenticate with your Google account. You can also set the `GOOGLE_APPLICATION_CREDENTIALS` environment variable to point to a service account key file.

## Adding New Commands

You can add new commands by creating a new file in the `src/actions` directory. There are two ways to add a command: 1) as a javascript file or 2) as a shell script. The CLI will automatically detect and load the command, preferring the javascript file if both are present.

If the command is a javascript file, it should export an exec function:

```
import chalk from "chalk";
import getStdin from "get-stdin";

const log = console.log;

export const exec = async (context) => {
  const input = await getStdin();

  // context contains the flags and input

  if (!context.flags.quiet) {
    log(`via: ${context.personality}\n`);
    log(
      chalk.white(
        JSON.stringify(
          { ...context, stdin: input, env: { ...process.env } },
          null,
          2
        )
      )
    );
  }
};

export const description = "hello world example in javascript";
```
