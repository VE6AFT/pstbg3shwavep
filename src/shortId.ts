export const SHORT_ID_LENGTH = 12;
export const SHORT_ID_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

type RandomBytes = (length: number) => Uint8Array;

type ShortIdOptions = {
  length?: number;
  randomBytes?: RandomBytes;
};

const MAX_GENERATION_ATTEMPTS = 1000;

function cryptoRandomBytes(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function randomShortIdSuffix(options: ShortIdOptions = {}) {
  const length = options.length ?? SHORT_ID_LENGTH;
  const randomBytes = options.randomBytes ?? cryptoRandomBytes;
  const maxUnbiasedByte = Math.floor(256 / SHORT_ID_ALPHABET.length) * SHORT_ID_ALPHABET.length;
  let suffix = "";
  let rounds = 0;

  while (suffix.length < length) {
    rounds += 1;
    if (rounds > MAX_GENERATION_ATTEMPTS) {
      throw new Error("Unable to generate a short id suffix");
    }

    const bytes = randomBytes((length - suffix.length) * 2);
    for (const byte of bytes) {
      if (byte >= maxUnbiasedByte) continue;
      suffix += SHORT_ID_ALPHABET[byte % SHORT_ID_ALPHABET.length];
      if (suffix.length === length) break;
    }
  }

  return suffix;
}

export function makeShortId(prefix: string, existingIds: Iterable<string> = [], options: ShortIdOptions = {}) {
  const existing = new Set(existingIds);

  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const id = `${prefix}-${randomShortIdSuffix(options)}`;
    if (!existing.has(id)) return id;
  }

  throw new Error(`Unable to generate a unique ${prefix} id`);
}
