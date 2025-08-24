function hexToString(hex) {
  return hex ? Buffer.from(hex, 'hex').toString('utf-8') : undefined;
}

function stringToHex(value) {
  return value ? Buffer.from(value, 'utf8').toString('hex').toUpperCase() : undefined;
}

function bytesToHex(value) {
  return Buffer.from(value).toString('hex').toUpperCase();
}

function hexToBytes(value) {
  if (value.length % 2 !== 0) {
    throw new Error('Invalid hex string length');
  }

  if (!/^[0-9a-fA-F]*$/.test(value)) {
    throw new Error('Invalid hex string');
  }

  if (value.length === 0) {
    return new Uint8Array(0);
  }

  return Uint8Array.from(Buffer.from(value, 'hex'));
}

// base64url.ts

function toBase64Url(b64) {
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(b64url) {
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  // Pad with '=' to make length a multiple of 4
  while (b64.length % 4) b64 += '=';
  return b64;
}

function encodeBase64Url(input) {
  let b64;
  if (typeof input === 'string') {
    // Browser + Node
    if (typeof Buffer !== 'undefined') {
      b64 = Buffer.from(input, 'utf8').toString('base64');
    } else {
      b64 = btoa(input);
    }
  } else {
    // Uint8Array
    if (typeof Buffer !== 'undefined') {
      b64 = Buffer.from(input).toString('base64');
    } else {
      let bin = '';
      input.forEach((b) => (bin += String.fromCharCode(b)));
      b64 = btoa(bin);
    }
  }
  return toBase64Url(b64);
}

function decodeBase64Url(b64url) {
  const b64 = fromBase64Url(b64url);

  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64, 'base64'));
  } else {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
}

export { hexToString, stringToHex, bytesToHex, hexToBytes, encodeBase64Url, decodeBase64Url };
