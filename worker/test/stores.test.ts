import { expect, it } from 'vitest';
import { memoryStores } from '../src/auth/stores';

it('increments epochs and mirrors attempt reset and cleanup semantics', async () => {
  const stores = memoryStores();
  expect(await stores.getEpoch()).toBe(1);
  expect(await stores.bumpEpoch()).toBe(2);
  expect(await stores.getEpoch()).toBe(2);
  expect(await stores.getAttempt('missing')).toBeNull();
  expect(await stores.recordFailure('a', 100, 50)).toEqual({ failCount: 1, windowStart: 100 });
  expect(await stores.recordFailure('a', 149, 50)).toEqual({ failCount: 2, windowStart: 100 });
  expect(await stores.recordFailure('a', 150, 50)).toEqual({ failCount: 1, windowStart: 150 });
  await stores.recordFailure('b', 86400151, 50);
  expect(await stores.getAttempt('a')).toBeNull();
  await stores.clearAttempt('b');
  expect(await stores.getAttempt('b')).toBeNull();
});
