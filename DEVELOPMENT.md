# Development Guide

## Local Development Setup

### Using Published NPM Package (Default)

By default, the CLI uses the published version of the Ident Agency SDK core package from npm:
- `@ident-agency/core`

```bash
pnpm install
pnpm link --global
```

### Using Local SDK Package

When developing both the CLI and SDK simultaneously, you can use the local version of the SDK core package:

1. Add the following to your `package.json`:

```json
"pnpm": {
  "overrides": {
    "@ident-agency/core": "file:../ident-agency-sdk/packages/core"
  }
}
```

2. Run `pnpm install` to link the local package

3. Make sure to build the SDK core package first:
```bash
cd ../ident-agency-sdk/packages/core
pnpm build
```

4. To switch back to the published package, remove the `pnpm` section from `package.json` and run `pnpm install` again.

## Publishing

Before publishing:
1. Ensure you're using the published SDK package (not local override)
2. Update the version number in `package.json`
3. Test the CLI thoroughly

```bash
# Dry run to see what will be published
pnpm publish:dry

# Publish to npm
pnpm publish:latest
```

## Testing as NPX

Test the package as if installed globally:

```bash
npx . help
# or
node src/ident-agency-cli.js help
```