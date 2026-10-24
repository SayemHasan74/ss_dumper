# Project workflow

- Use the user's current prompt and saved specification for the current part; stop at that part's boundary.
- Read and apply `C:/Users/SAM/.codex/skills/karpathy-guidelines/SKILL.md` for coding tasks.
- After each completed part, run its required checks, commit the completed changes, and push to `https://github.com/SayemHasan74/ss_dumper`.
- Never commit `.dev.vars`, credentials, `node_modules`, build output, or local Wrangler state. Never force-push.
- Keep the repository public for portfolio and recruiter review. Keep uploaded personal files, login keys, upload tokens, session secrets, and local environment files private; only empty or clearly non-secret example environment templates may be committed. Check staged changes for secrets before every push.
