import config from './config.js';

/**
 * Resolves the API base URL using the following priority:
 * 1. --api-url flag (highest priority)
 * 2. apiBaseUrl in config file
 * 3. Production default: https://www.ident.agency
 * 
 * @param {string} [flagValue] - Value from --api-url flag
 * @param {boolean} [debug=false] - Whether to log debug information
 * @returns {string} The resolved API base URL
 */
export function resolveApiBaseUrl(flagValue, debug = false) {
  const PRODUCTION_URL = 'https://www.ident.agency';
  
  let resolvedUrl;
  let source;
  
  if (flagValue) {
    // 1. Flag takes highest priority
    resolvedUrl = flagValue;
    source = 'flag';
  } else if (config.has('apiBaseUrl')) {
    // 2. Config file setting
    resolvedUrl = config.get('apiBaseUrl');
    source = 'config';
  } else {
    // 3. Production default
    resolvedUrl = PRODUCTION_URL;
    source = 'default';
  }
  
  // Ensure URL doesn't have trailing slash
  resolvedUrl = resolvedUrl.replace(/\/$/, '');
  
  if (debug) {
    console.log(`🔧 API URL: ${resolvedUrl} (from ${source})`);
  }
  
  return resolvedUrl;
}

/**
 * Sets the API base URL in the config file
 * @param {string} url - The API base URL to store
 */
export function setApiBaseUrl(url) {
  const cleanUrl = url.replace(/\/$/, '');
  config.set('apiBaseUrl', cleanUrl);
}

/**
 * Gets the current API base URL from config (if set)
 * @returns {string|undefined} The configured API base URL or undefined
 */
export function getConfigApiBaseUrl() {
  return config.get('apiBaseUrl');
}

/**
 * Clears the API base URL from config
 */
export function clearApiBaseUrl() {
  config.delete('apiBaseUrl');
}