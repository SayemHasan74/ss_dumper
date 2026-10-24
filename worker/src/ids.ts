const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const maxTimestamp = 0xffffffffffff;
let lastTimestamp = -1;
const random = new Uint8Array(10);

export function ulid(): string {
  let timestamp = Math.max(Date.now(), lastTimestamp);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > maxTimestamp) {
    throw new Error('ULID timestamp is out of range.');
  }

  if (timestamp === lastTimestamp) {
    let index = random.length - 1;
    while (index >= 0 && random[index] === 255) {
      random[index] = 0;
      index -= 1;
    }
    if (index >= 0) {
      random[index] += 1;
    } else {
      if (timestamp === maxTimestamp) throw new Error('ULID range exhausted.');
      timestamp += 1;
      crypto.getRandomValues(random);
    }
  } else {
    crypto.getRandomValues(random);
  }
  lastTimestamp = timestamp;

  let timePart = '';
  for (let index = 0; index < 10; index += 1) {
    timePart = alphabet[timestamp % 32] + timePart;
    timestamp = Math.floor(timestamp / 32);
  }

  let randomPart = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of random) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      randomPart += alphabet[(buffer >>> bits) & 31];
    }
    buffer &= (1 << bits) - 1;
  }
  return timePart + randomPart;
}
