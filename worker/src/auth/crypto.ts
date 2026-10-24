export const utf8 = (value: string): Uint8Array<ArrayBuffer> => new Uint8Array(new TextEncoder().encode(value));

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function b64urlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    if (!/^[A-Za-z0-9_-]*$/.test(value) || value.length % 4 === 1) return null;
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return b64urlEncode(bytes) === value ? bytes : null;
  } catch { return null; }
}

export function timingSafeEqual(a: string, b: string): boolean {
  const left = utf8(a);
  const right = utf8(b);
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

let cachedSecret: string | undefined;
let cachedKey: Promise<CryptoKey> | undefined;
function hmacKey(secret: string): Promise<CryptoKey> {
  if (cachedSecret !== secret || !cachedKey) {
    cachedSecret = secret;
    cachedKey = crypto.subtle.importKey('raw', utf8(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  }
  return cachedKey;
}
export async function hmacSign(secret: string, value: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), utf8(value)));
}
export async function hmacVerify(secret: string, value: string, signature: Uint8Array<ArrayBuffer>): Promise<boolean> {
  return crypto.subtle.verify('HMAC', await hmacKey(secret), signature, utf8(value));
}
