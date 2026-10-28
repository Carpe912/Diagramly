# Project workflow

- After completing and verifying a feature or fix, automatically create a Git commit for that feature. The user has authorized this workflow for all future changes in this repository.
- Keep unrelated functional changes in separate commits and report the resulting commits.
- Never commit credentials, local session files, or `.env.local`. Live backend verification should use read-only requests unless the user authorizes a specific business write.
