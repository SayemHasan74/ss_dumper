import { afterEach, expect, it, vi } from 'vitest';
import { isUlid, ulid, ulidCeil, ulidFloor, ulidTime } from '../src/ids';

afterEach(() => vi.restoreAllMocks());
it('generates monotonic Crockford ULIDs and round-trips timestamp bounds', () => {
  const time = 1792860000000;
  vi.spyOn(Date, 'now').mockReturnValue(time);
  const ids = Array.from({ length: 1000 }, () => ulid());
  expect(ids.every(isUlid)).toBe(true);
  expect(new Set(ids).size).toBe(1000);
  expect(ids).toEqual([...ids].sort());
  for (const id of ids) {
    expect(ulidTime(id)).toBe(time);
    expect(id > ulidFloor(time) && id < ulidCeil(time)).toBe(true);
  }
});
it.each(['I', 'L', 'O', 'U', 'i'])('rejects excluded character %s', (char) => {
  expect(isUlid('0'.repeat(25) + char)).toBe(false);
});
it('rejects wrong lengths and invalid timestamp bounds', () => {
  expect(isUlid('0'.repeat(25))).toBe(false);
  expect(isUlid('0'.repeat(27))).toBe(false);
  expect(() => ulidFloor(-1)).toThrow();
  expect(() => ulidCeil(0x1000000000000)).toThrow();
});
