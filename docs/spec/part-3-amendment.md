Yes, use that fix. It’s a real contradiction in my spec, and your fix is the right one.

**Details to include:**

- **Return type:** `deleteMany(keys): Promise<{ failed: number; quotaExceeded: boolean }>`. It still never throws.
- **Quota detection:** set `quotaExceeded = true` when any delete fails with a message that `isStorageQuotaMessage` matches. That is the same check `putStream` and `putBytes` use.
- **Stop early:** once a quota error is seen, don’t start any more delete groups. The remaining keys count as `failed`, which saves wasted calls.
- **Logging:** log `kv_delete_fail` once per call. Don’t log the keys.

**Where it applies:**

- **Empty Trash and bulk `purge`:** rows are already deleted from D1 at this point. If `quotaExceeded` is true, respond `429 DAILY_LIMIT`; if not, respond success. The orphan sweep cleans up leftover KV objects later.
- **Permanent delete of one file:** ignore the flag and still return success, as the spec says. The orphan sweep handles the leftovers.
- **Part 8 maintenance:** this has the same gap. I wrote that a `StorageQuotaError` ends the KV steps, but `deleteMany` never throws. Use `quotaExceeded` instead: stop the purge and orphan steps for this run and log `maintenance_quota`.
- **Tests:** add a case to `storage.test.ts` where a fake KV throws “limit exceeded” on delete. It should return `quotaExceeded: true` without throwing, and issue no deletes after the first quota failure.

Log it in `DECISIONS.md`. Part 8 and the Part 6 Trash text need no other changes, since the 429 behavior is already specified.
