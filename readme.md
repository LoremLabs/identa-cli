# Ident Agency CLI

Command-line interface for [Ident Agency](https://www.ident.agency) - secure, privacy-preserving identity and data management.

## Installation

Install the CLI globally to use it from anywhere:

```bash
npm install -g @ident-agency/identa-cli
```

Or using npx (without installation):

```bash
npx @ident-agency/identa-cli help
```

```bash
npm install -g @ident-agency/identa-cli
```

Or using npx (without installation):
```bash
npx @ident-agency/identa-cli help
```

```bash
npx @ident-agency/identa-cli help
```

Or install the binary
```bash
curl -fsSL https://get.ident.agency/install.sh | sh
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

## Common Commands

### Authentication

```bash
# Login to Ident.Agency (opens browser for OAuth flow)
identa auth login

# View your profile information
identa auth profile

# Logout
identa auth logout

# Change password
identa auth change-password
```

### Fragments (Data Management)

```bash
# List fragments (alias: ls)
identa fragment list
identa fragment ls

# Get a fragment value
identa fragment get <path>
# Example: identa fragment get profile/name

# Write/update a fragment
identa fragment put <path> <value>
# Example: identa fragment put profile/bio "Software developer"

# Get raw fragment data (includes metadata)
identa fragment raw <path>

# Delete a fragment
identa fragment delete <path>
# Example: identa fragment delete profile/old-data

# Recover a deleted fragment
identa fragment recover <path>
```

### Secrets Management (Local Device Secrets)

```bash
# Set the secrets provider (local, gcp)
identa secrets provider <provider>
# Example: identa secrets provider local

# Store a secret locally
identa secrets set <key> <value>
# Example: identa secrets set github-token ghp_xxxxx

# Retrieve a secret
identa secrets get <key>

# List all secrets
identa secrets list

# Delete a secret
identa secrets delete <key>

# Google Cloud Platform secrets (if configured)
identa secrets gcp <project-id> <secret-name>
```

### Key Management

```bash
# Register a new key/device
identa keys register

# List registered keys
identa keys list

# Remove a key
identa keys remove <key-id>

# Test key functionality
identa keys test

# Device-specific operations
identa keys device

# Recovery key operations
identa keys recovery

# SSH key operations
identa keys ssh
```

### Advanced Options

```bash
# Enable debug output
identa auth login --debug

# Use a different API endpoint
identa auth login --api-url https://staging.ident.agency

# Output as JSON (where supported)
identa fragment get profile --json
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

