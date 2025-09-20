import { getSecretProvider } from './secrets.js';

/**
 * Creates a device key storage provider for the SDK
 * This wraps the CLI's secret provider with a simpler interface
 */
export async function createDeviceKeyStorageProvider() {
  const secrets = await getSecretProvider();
  const service = 'ident-agency-cli';

  return {
    async get(key) {
      return await secrets.get(service, key);
    },

    async set(key, value) {
      await secrets.set(service, key, value);
    },

    async delete(key) {
      if (secrets.delete) {
        await secrets.delete(service, key);
      }
    },
  };
}
