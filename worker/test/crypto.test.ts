import { describe, expect, it } from 'vitest';
import { b64urlDecode, b64urlEncode, hmacSign, hmacVerify, sha256Hex, timingSafeEqual, utf8 } from '../src/auth/crypto';

describe('crypto primitives', () => {
  it('uses the standard SHA-256 vector', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('compares all equal-length bytes and handles different lengths', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    expect(timingSafeEqual('é', 'e')).toBe(false);
  });
  it('round-trips arbitrary bytes and Unicode without padding', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
    expect(b64urlDecode(b64urlEncode(bytes))).toEqual(bytes);
    expect(new TextDecoder().decode(b64urlDecode(b64urlEncode(utf8('বাংলা')))!)).toBe('বাংলা');
    expect(b64urlEncode(utf8('f'))).toBe('Zg');
  });
  it.each(['=', 'a', '***', 'a+b/', 'a b', 'Zg=', 'Zh', '💥'])('rejects invalid base64url %s', (value) => {
    expect(b64urlDecode(value)).toBeNull();
  });
  it('verifies HMAC and handles changed secrets', async () => {
    const signature = await hmacSign('test-secret', 'payload');
    expect(await hmacVerify('test-secret', 'payload', signature)).toBe(true);
    expect(await hmacVerify('other-secret', 'payload', signature)).toBe(false);
    expect(await hmacVerify('test-secret', 'tampered', signature)).toBe(false);
  });
});
