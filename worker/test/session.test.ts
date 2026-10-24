import { describe, expect, it } from 'vitest';
import { CLOCK_SKEW_MS, SESSION_ABSOLUTE_MS, SESSION_RENEW_THRESHOLD_MS, SESSION_SLIDING_MS } from '../src/auth/config';
import { b64urlEncode, hmacSign, utf8 } from '../src/auth/crypto';
import { createSession, shouldRenew, verifySession } from '../src/auth/session';
import { secret, start } from './helpers';

async function signed(payload: unknown): Promise<string> {
  const encoded = b64urlEncode(utf8(JSON.stringify(payload)));
  return `v1.${encoded}.${b64urlEncode(await hmacSign(secret, `v1.${encoded}`))}`;
}
describe('sessions', () => {
  it('creates and verifies the exact payload', async () => {
    const token = await createSession(secret, start, 1);
    expect(await verifySession(token, secret, start, 1)).toEqual({ iat: start, exp: start + SESSION_SLIDING_MS, ep: 1 });
  });
  it('rejects changed payload, signature, version, secret and epoch', async () => {
    const token = await createSession(secret, start, 1);
    const [, payload, signature] = token.split('.');
    for (const bad of [`v1.${payload}A.${signature}`, `v1.${payload}.${signature.slice(1)}`, token.replace('v1.', 'v2.')]) {
      expect(await verifySession(bad, secret, start, 1)).toBeNull();
    }
    expect(await verifySession(token, 'other-secret', start, 1)).toBeNull();
    expect(await verifySession(token, secret, start, 2)).toBeNull();
  });
  it('rejects expiry, future issuance and absolute lifetime at the boundaries', async () => {
    expect(await verifySession(await createSession(secret, start, 1), secret, start + SESSION_SLIDING_MS, 1)).toBeNull();
    expect(await verifySession(await signed({ iat: start + CLOCK_SKEW_MS + 1, exp: start + SESSION_SLIDING_MS, ep: 1 }), secret, start, 1)).toBeNull();
    expect(await verifySession(await signed({ iat: start - SESSION_ABSOLUTE_MS, exp: start + 1, ep: 1 }), secret, start, 1)).toBeNull();
    expect(await verifySession(await signed({ iat: start + CLOCK_SKEW_MS, exp: start + 1000000, ep: 1 }), secret, start, 1)).not.toBeNull();
  });
  it('never throws for garbage and malformed signed payloads', async () => {
    const garbage = ['', 'v1', 'v1.a', 'v1.a.b.c', 'x'.repeat(10000), 'v1.***.aaa', 'v1..', 'v1.Zg.Zg', 'v1.Zg=.Zg'];
    for (const value of [null, [], {}, { iat: '1', exp: start + 1, ep: 1 }, { iat: start, exp: '2', ep: 1 }, { iat: start, exp: start + 1, ep: 1.2 }, { iat: start + 0.1, exp: start + 1, ep: 1 }]) garbage.push(await signed(value));
    const nonJson = b64urlEncode(utf8('not-json'));
    garbage.push(`v1.${nonJson}.${b64urlEncode(await hmacSign(secret, `v1.${nonJson}`))}`);
    for (const token of garbage) expect(await verifySession(token, secret, start, 1)).toBeNull();
  });
  it('renews only below threshold and preserves issuance and absolute cap', async () => {
    const payload = { iat: start, exp: start + SESSION_SLIDING_MS, ep: 1 };
    expect(shouldRenew(payload, payload.exp - SESSION_RENEW_THRESHOLD_MS)).toBe(false);
    expect(shouldRenew(payload, payload.exp - SESSION_RENEW_THRESHOLD_MS + 1)).toBe(true);
    const later = start + SESSION_ABSOLUTE_MS - 86400000;
    const renewed = await verifySession(await createSession(secret, later, 1, start), secret, later, 1);
    expect(renewed?.iat).toBe(start);
    expect(renewed?.exp).toBe(start + SESSION_ABSOLUTE_MS);
  });
});
