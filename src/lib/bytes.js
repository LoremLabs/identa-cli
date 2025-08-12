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

export { hexToString, stringToHex, bytesToHex, hexToBytes };
