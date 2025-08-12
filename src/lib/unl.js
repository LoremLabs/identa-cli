import * as Validator from './validator.js';

import { bytesToHex } from './bytes.js';
import { decodeNodePublic } from 'ripple-address-codec';
import { encode } from 'ripple-binary-codec';
import { generateSecrets } from './validator.js';

export const RIPPLE_UNIX_DIFF = 946684800;

export function unixTimeToLedgerTime(time) {
  return time - RIPPLE_UNIX_DIFF;
}

export function encodeVLBlob(vlBlob) {
  return Buffer.from(JSON.stringify(vlBlob)).toString('base64');
}

export function generateManifest(manifest) {
  const verifyFields = [Buffer.from('MAN\x00', 'utf-8')];

  // Sequence (soeREQUIRED)
  const sequenceBuffer = Buffer.alloc(5);
  sequenceBuffer.writeUInt8(0x24);
  sequenceBuffer.writeUInt32BE(manifest.Sequence, 1);
  verifyFields.push(sequenceBuffer);

  // PublicKey (soeREQUIRED)
  const publicKeyBuffer = Buffer.alloc(35);
  publicKeyBuffer.writeUInt8(0x71);
  publicKeyBuffer.writeUInt8(manifest.PublicKey.length / 2, 1);
  publicKeyBuffer.write(manifest.PublicKey, 2, 'hex');
  verifyFields.push(publicKeyBuffer);

  // SigningPubKey (soeOPTIONAL)
  const signingPubKeyBuffer = Buffer.alloc(35);
  signingPubKeyBuffer.writeUInt8(0x73);
  signingPubKeyBuffer.writeUInt8(manifest.SigningPubKey.length / 2, 1);
  signingPubKeyBuffer.write(manifest.SigningPubKey, 2, 'hex');
  verifyFields.push(signingPubKeyBuffer);

  // Domain (soeOPTIONAL)
  if (manifest.Domain) {
    const domainBuffer = Buffer.alloc(2 + manifest.Domain.length / 2); // eslint-disable-line no-mixed-operators
    domainBuffer.writeUInt8(0x77);
    domainBuffer.writeUInt8(manifest.Domain.length / 2, 1);
    domainBuffer.write(manifest.Domain, 2, 'hex');
    verifyFields.push(domainBuffer);
  }

  const verifyData = Buffer.concat(verifyFields);

  // Signature (soeOPTIONAL)
  const ephemeralSignature = Validator.sign(verifyData, manifest.SigningPrivateKey);

  // MasterSignature (soeREQUIRED)
  const masterSignature = Validator.sign(verifyData, manifest.MasterPrivateKey);

  const manifestBuffer = Buffer.from(
    encode({
      Sequence: manifest.Sequence,
      PublicKey: manifest.PublicKey,
      SigningPubKey: manifest.SigningPubKey,
      Signature: ephemeralSignature,
      Domain: manifest.Domain,
      MasterSignature: masterSignature,
    }),
    'hex'
  );
  return manifestBuffer.toString('base64');
}

export async function getVLBlobValidatorsManifest(validatorsPublicKeys, identClient) {
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  async function fetchWithRetry(publicKey, max = 5) {
    for (let attempt = 0; attempt < max; attempt++) {
      const response = await identClient.request({
        command: 'manifest',
        public_key: publicKey,
      });

      if (response.result?.error === 'slowDown') {
        const wait = 500 + attempt * 500;
        console.warn(`⏳ Rate limited on ${publicKey}, retrying in ${wait}ms`);
        await delay(wait);
      } else if (response.result?.error) {
        throw new Error(response.result.error);
      } else {
        return response.result;
      }
    }
    throw new Error(`Too many retries for ${publicKey}`);
  }

  const manifests = [];
  for (const pk of validatorsPublicKeys) {
    manifests.push(await fetchWithRetry(pk));
  }

  return manifests.map((info) => {
    const validationPublicKey = info.requested;
    const buffer = decodeNodePublic(validationPublicKey);
    const publicKey = bytesToHex(buffer.buffer);
    return {
      validation_public_key: publicKey,
      manifest: info.manifest,
    };
  });
}

export async function createVLBlob(sequence, expiration, validatorsPublicKeys, identClient) {
  const validators = await getVLBlobValidatorsManifest(validatorsPublicKeys, identClient);
  return {
    sequence,
    expiration: unixTimeToLedgerTime(expiration),
    validators,
  };
}

export async function createVL(
  masterKey,
  ephemeralKey,
  sequence,
  expiration,
  validatorsPublicKeys,
  identClient
) {
  const vlBlob = await createVLBlob(sequence, expiration, validatorsPublicKeys, identClient);
  const blob = encodeVLBlob(vlBlob);
  const manifest = generateManifest({
    Sequence: sequence,
    PublicKey: masterKey.publicKey,
    SigningPubKey: ephemeralKey.publicKey,
    SigningPrivateKey: ephemeralKey.privateKey,
    MasterPrivateKey: masterKey.privateKey,
  });
  const signature = Validator.sign(Buffer.from(blob, 'base64'), ephemeralKey.privateKey);

  return {
    blob,
    manifest,
    signature,
    public_key: masterKey.publicKey,
    version: 1,
  };
}

export const generateKeyPair = () => {
  const rawKeypair = generateSecrets();

  const keypair = {
    key_type: rawKeypair.key_type,
    secret_key: rawKeypair.secret_key,
    nodePublicKeyBase58: rawKeypair.public_key, // prefixed with n to indicate it's a validator key [was public_key]
    nodePublicKeyHex: rawKeypair.PublicKey, // hex string raw ED25519 key [was PublicKey]
  };

  return keypair;
};
