# Ident Agency CLI

Command-line interface for Ident Agency - secure, privacy-preserving identity and data management.

## Installation

### Global Installation (Recommended)

Install the CLI globally to use it from anywhere:

```bash
npm install -g @ident-agency/identa-cli
```

Or using npx (without installation):

```bash
npx @ident-agency/identa-cli help
```

### Local Development

For development, clone the repository and link locally:

```bash
pnpm install
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

### API URL Configuration

The CLI needs to know which Ident.Agency server to connect to. The API URL is resolved in the following priority order:

1. **Command-line flag** `--api-url` (highest priority)
2. **Config file setting** `apiBaseUrl`
3. **Default** `https://www.ident.agency` (production)

#### Set to Production (default)
```bash
# Remove any custom setting to use the default production URL
identa config delete apiBaseUrl

# Or explicitly set to production
identa config set apiBaseUrl https://www.ident.agency
```

#### Set to Local Development
```bash
identa config set apiBaseUrl http://localhost:5173
```

#### Check Current Setting
```bash
identa config get apiBaseUrl
```

#### Override Temporarily
Use the `--api-url` flag to override for a single command:
```bash
identa auth login --api-url=https://www.ident.agency
```

#### Debug Mode
Use `--debug` to see which API URL is being used and its source:
```bash
identa auth login --debug
# Output: 🔧 API URL: https://www.ident.agency (from config)
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
