import Conf from 'conf';
import toml from '@iarna/toml';

// automatically create the config directory in the user's home directory
const config = new Conf({
  projectName: 'ident-agency',
  fileExtension: 'toml',
  serialize: (store) => {
    return toml.stringify(store);
  },
  deserialize: (inputToml) => {
    return toml.parse(inputToml);
  },
});

export default config;
