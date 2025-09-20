import { GoogleAuth } from 'google-auth-library';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import chalk from 'chalk';
import config from './config.js';
import prompts from 'prompts';
import { spawnSync } from 'child_process';

class SecretProvider {
  async get() {}
  async set() {}
  async delete() {}
  async list() {}
  async setup() {}
  type() {}
}

class KeytarProvider extends SecretProvider {
  async loadKeytar() {
    try {
      const keytar = await import('keytar');
      return keytar.default ?? keytar; // handle ESModule vs CommonJS
    } catch (e) {
      throw new Error(
        'Keytar could not be loaded. Make sure it is installed and supports your platform.'
      );
    }
  }

  async get(service, key) {
    const keytar = await this.loadKeytar();
    return keytar.getPassword(service, key);
  }

  async set(service, key, value) {
    const keytar = await this.loadKeytar();
    return keytar.setPassword(service, key, value);
  }

  async delete(service, key) {
    const keytar = await this.loadKeytar();
    return keytar.deletePassword(service, key);
  }

  async list() {
    console.warn('Listing not supported for keytar');
    return [];
  }

  async setup() {
    return true;
  }

  type() {
    return 'local';
  }
}

class GCPSecretManagerProvider extends SecretProvider {
  constructor() {
    super();
    this.client = null; // new SecretManagerServiceClient();
    this.projectId = process.env.GCP_PROJECT_ID || config.get('gcp_project_id');
    if (!this.projectId) {
      console.log(chalk.blue(`GCP Secret Manager project ID: ${this.projectId || 'not set'}`));
    }
  }

  _secretPath(service, key) {
    return `projects/${this.projectId}/secrets/${service}_${key}`;
  }

  type() {
    return 'gcp';
  }

  async setup() {
    let client;

    const isGithubActions = process.env.GITHUB_ACTIONS === 'true';

    const getAuthStatus = async () => {
      try {
        client = new SecretManagerServiceClient();

        const [projectId] = await client.getProjectId();

        if (!projectId) {
          console.error(chalk.red('❌ GCP project ID could not be detected'));
          return false;
        }

        if (isGithubActions) {
          // Assume auth was already set up via exported credentials
          this.client = client;
          return true;
        } else {
          const auth = new GoogleAuth({
            scopes: 'https://www.googleapis.com/auth/cloud-platform',
          });

          const tokenClient = await auth.getClient();
          const tokenRes = await tokenClient.getAccessToken();

          if (!tokenRes || !tokenRes.token) {
            console.error(chalk.red('❌ Failed to get GCP access token'));
            return false;
          }
        }

        console.log(chalk.green('✅ GCP authentication successful'));
        this.client = client;
        return true;
      } catch (err) {
        console.error(chalk.red('❌ GCP authentication failed'));
        console.error(err);
        return false;
      }
    };

    const authStatus = await getAuthStatus();
    if (authStatus) {
      // console.log('GCP Secret Manager client authenticated');
      this.client = client;
      return true;
    } else {
      const { login } = await prompts({
        type: 'confirm',
        name: 'login',
        message: 'Would you like to log in to Google Cloud Platform now?',
        initial: true,
      });

      if (login) {
        try {
          console.log(chalk.white('🔐 Logging in to GCP...'));
          const result = spawnSync('gcloud', ['auth', 'application-default', 'login'], {
            stdio: 'inherit',
          });

          if (result.status === 0) {
            console.log('\n✅ GCP login successful');
            console.log('You can now run the command again.\n');
          } else {
            console.error('\n❌ GCP login failed.');
            process.exit(result.status ?? 1);
          }

          process.exit(0);
        } catch (e) {
          console.error('\n❌ GCP login failed. Please try running it manually:');
          console.error('   gcloud auth application-default login\n');
          process.exit(1);
        }
      } else {
        console.error(
          chalk.red('❌ GCP Secret Manager setup failed. Please run the command again.')
        );
        process.exit(1);
      }
    }
  }

  async get(service, key) {
    if (!this.projectId) {
      throw new Error(
        'GCP_PROJECT_ID is not set. Please set it in your config or environment variables.'
      );
    }

    let result;
    try {
      console.log(chalk.white(`🔍 Fetching secret: ${service}/${key}`));
      result = await this.client.accessSecretVersion({
        name: `${this._secretPath(service, key)}/versions/latest`,
      });
    } catch (e) {
      console.error(
        chalk.red(`❌ Failed to access secret: ${this._secretPath(service, key)}/versions/latest`)
      );
      console.error(e);
      if (e.code === 2) {
        if (e.message.includes('status code 400')) {
          throw new Error('GCP Auth failed. Please check your credentials and permissions.');
        }
      } else if (e.code === 5) {
        console.error(chalk.red(`❌ Secret ${service}/${key} not found or empty`));
        return null; // secret not found
      } else {
        console.error(chalk.red(`❌ An unexpected error occurred while fetching the secret`));
        throw e;
      }
    }
    const [version] = result;
    if (!version || !version.payload || !version.payload.data) {
      console.error(chalk.red(`❌❌ Secret ${service}/${key} not found or empty`));
      return null;
    }
    console.log(chalk.green(`✅ Secret ${service}/${key} fetched successfully`));
    return version.payload?.data?.toString('utf8') ?? null;
  }

  async set(service, key, value) {
    if (!this.projectId) {
      throw new Error(
        'GCP_PROJECT_ID is not set. Please set it in your config or environment variables.'
      );
    }

    const secretId = `${service}_${key}`;
    try {
      await this.client.createSecret({
        parent: `projects/${this.projectId}`,
        secretId,
        secret: { replication: { automatic: {} } },
      });
    } catch (e) {
      if (!e.message.includes('ALREADY_EXISTS')) throw e;
    }

    await this.client.addSecretVersion({
      parent: this._secretPath(service, key),
      payload: { data: Buffer.from(value, 'utf8') },
    });
  }

  async delete(service, key) {
    if (!this.projectId) {
      throw new Error(
        'GCP_PROJECT_ID is not set. Please set it in your config or environment variables.'
      );
    }

    await this.client.deleteSecret({ name: this._secretPath(service, key) });
  }

  async list() {
    console.warn('Listing not yet implemented for GCP');
    return [];
  }
}

export async function getSecretProvider() {
  const backend = process.env.IDENT_CLI_SECRET_BACKEND || config.get('secret_backend') || 'local';
  if (backend === 'gcp') {
    const secrets = new GCPSecretManagerProvider();
    await secrets.setup();
    return secrets;
  } else {
    return new KeytarProvider();
  }
}
