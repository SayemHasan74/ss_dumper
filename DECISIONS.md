# Decisions

- Use the selected E:\Codes\Drop folder as the repository root; keep Dump as the product and package name required by the spec.
- Keep ULIDs monotonic during clock rollback by retaining the last timestamp; advance the timestamp on random-field overflow to preserve uniqueness.
- Use 1 KB = 1024 bytes for gzip budgets so the limits are deterministic.
- Interpret the secret generator's Node crypto-only requirement as no third-party dependencies; use node:fs solely for the required .dev.vars output.
- Print credentials only in the explicitly requested interactive generator; verification captures output without displaying credentials.
- Include Vite client types for the CSS side-effect import under strict TypeScript checking.
- Require Node 22.12+ within the specified Node 20+ range because the selected current Wrangler, Vite, Vitest, and concurrently releases need it; verification uses the installed Node 24.20.0.
- Replace the R2-era Part 1 spec with the user's revised attachment verbatim; it is the current implementation source.
- Use the already-created dump-files KV namespace with binding FILES and the already-created dump-db D1 database; configure their verified IDs instead of creating duplicate resources.
- Keep storage behavior in Part 3; Part 1 only replaces the binding and documents the revised 900 MB cap and KV constraints.
