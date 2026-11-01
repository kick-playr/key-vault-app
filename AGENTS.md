<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Repository workflow

- Make future changes directly on the `development` branch in this primary checkout, as requested by the user on 2026-11-01.
- Do not create feature branches, pull requests or isolated worktrees unless the user explicitly requests them.
- Fetch and fast-forward published development before starting when safe; preserve unrelated local edits.
- Run checks appropriate to each change before committing and pushing development. Do not merge or deploy unrelated work.
