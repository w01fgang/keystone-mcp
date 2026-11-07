# Upstream

- Source: https://github.com/dmmulroy/anti-slop, path `skills/install-anti-slop/assets/anti-slop/`.
- Commit: `13909c9e07590f5a85d93c62712259fe14a883f7` (2026-10-13). On 2026-11-07, `diff -r` showed this directory identical to that path at that commit, apart from this file.
- Installed with `node .agents/skills/install-anti-slop/scripts/install.mjs` from the `install-anti-slop` skill, which `skills-lock.json` records.
- Entry point: `tools/oxlint/anti-slop/index.ts`, registered as `anti-slop` in `.oxlintrc.json` with every generic rule at `error`.
- The Effect plugin (`effect/`) is copied but not registered: the package does not depend on `effect`.
- Dependencies: `oxlint` and `@oxlint/plugins`, both pinned at 1.92.0.
- Local deviations: none.
