// https://github.com/Bithomp/ident-api/blob/9de022ab382f6d71c64135930a117e564a9af392/src/validator.ts
// converted to js/esm

import * as rippleKeypairs from 'ripple-keypairs';

import { codec, decodeNodePublic, encodeAccountID, encodeNodePublic } from 'ripple-address-codec';

import assert from 'assert';
import { bytesToHex } from './bytes.js';
import crypto from 'crypto';
import elliptic from 'elliptic';

const secp256k1 = new elliptic.ec('secp256k1');
const ed25519 = new elliptic.eddsa('ed25519');

const DER_PRIVATE_KEY_PREFIX = Buffer.from('302E020100300506032B657004220420', 'hex');
const DER_PUBLIC_KEY_PREFIX = Buffer.from('302A300506032B6570032100', 'hex');
const VALIDATOR_HEX_PREFIX_ED25519 = 'ED';
const VALIDATOR_NODE_PUBLIC_KEY_PREFIX = 'n';

export function classicAddressFromValidatorPK(pk) {
  let pubkey = pk;
  if (typeof pk === 'string') {
    pubkey = Buffer.from(decodeNodePublic(pk).buffer);
  }

  assert.ok(pubkey.length === 33);
  assert.ok(crypto.getHashes().includes('sha256'));
  assert.ok(crypto.getHashes().includes('ripemd160'));

  const pubkeyInnerHash = crypto.createHash('sha256').update(pubkey);
  const pubkeyOuterHash = crypto.createHash('ripemd160');
  pubkeyOuterHash.update(pubkeyInnerHash.digest());
  const accountID = pubkeyOuterHash.digest();

  return encodeAccountID(accountID);
}

export function generateSecrets() {
  const keypair = crypto.generateKeyPairSync('ed25519', {
    privateKeyEncoding: { format: 'der', type: 'pkcs8' },
    publicKeyEncoding: { format: 'der', type: 'spki' },
  });

  const { privateKey, publicKey } = keypair;

  const PublicKey =
    VALIDATOR_HEX_PREFIX_ED25519 +
    publicKey.slice(DER_PUBLIC_KEY_PREFIX.length).toString('hex').toUpperCase();

  const secretKey = codec.encode(privateKey.slice(DER_PRIVATE_KEY_PREFIX.length), {
    versions: [0x20],
    expectedLength: 32,
  });

  return {
    key_type: 'ed25519',
    secret_key: secretKey,
    public_key: encodeNodePublic(Buffer.from(PublicKey, 'hex')),
    PublicKey,
  };
}

export function sign(message, secret) {
  if (typeof message === 'string') {
    message = Buffer.from(message, 'utf8');
  }

  try {
    const decoded = codec.decode(secret, { versions: [0x20] });
    secret = VALIDATOR_HEX_PREFIX_ED25519 + bytesToHex(decoded.bytes.buffer);
  } catch (_err) {
    // ignore
  }

  return rippleKeypairs.sign(message.toString('hex'), secret).toUpperCase();
}

export function verify(message, signature, publicKey) {
  if (typeof message === 'string') {
    message = Buffer.from(message, 'utf8');
  }

  if (publicKey.startsWith(VALIDATOR_NODE_PUBLIC_KEY_PREFIX)) {
    const publicKeyBuffer = decodeNodePublic(publicKey);
    publicKey = bytesToHex(publicKeyBuffer.buffer);
  }

  try {
    return rippleKeypairs.verify(message.toString('hex'), signature, publicKey);
  } catch {
    return false;
  }
}

export function verify2(message, signature, publicKey) {
  if (publicKey.startsWith(VALIDATOR_NODE_PUBLIC_KEY_PREFIX)) {
    const publicKeyBuffer = decodeNodePublic(publicKey);
    publicKey = bytesToHex(publicKeyBuffer.buffer);
  }

  if (publicKey.startsWith(VALIDATOR_HEX_PREFIX_ED25519)) {
    const verifyKey = ed25519.keyFromPublic(publicKey.slice(2));
    return verifyKey.verify(message.toString('hex'), signature);
  } else {
    const computedHash = crypto
      .createHash('sha512')
      .update(message)
      .digest()
      .toString('hex')
      .slice(0, 64);
    const verifyKey = secp256k1.keyFromPublic(publicKey, 'hex');
    return verifyKey.verify(computedHash, signature);
  }
}
