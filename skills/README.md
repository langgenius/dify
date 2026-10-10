# difyctl skill

One agent skill for the difyctl CLI: `skills/difyctl/`. It uses the standard
Agent Skills layout. `SKILL.md` is the root; the docs it links to sit under
`references/`.

The difyctl binary carries a built-in copy. `difyctl install skills <dir>`
writes that copy into `<dir>`. `--from <folder>` installs a local folder with
the same layout instead. The same files install through the Vercel installer:
`npx skills add langgenius/dify --skill difyctl -g`.

## Changing the skill

The skill is a tree of linked docs, so an agent reads only the branch it needs.

- `SKILL.md` frontmatter has `name` (`difyctl`) and `description`. The
  description says when to use the skill.
- `SKILL.md` and the docs it links to are maps. Keep each map under 60 lines.
- The docs one level further down are leaves. A leaf may link only to other
  leaves in its own folder.
- Every doc is at most 2 hops from `SKILL.md`.
- Write links as "Read X when ...", so the agent knows when to follow them.
- In a leaf over 100 lines, `## Contents` is the first `##` heading.
- Put each fact in one place and link to it from elsewhere.
- Any file in `skills/difyctl/` ships. Files starting with `#!` are installed
  executable.

`cli/test/skills/tree.test.ts` checks links, depth, sizes, and every `difyctl`
command, in backticks or in code blocks. Each command must exist locally or in
`cli/test/fixtures/catalog.json`, and each flag on an operation must be one of
its input fields or a CLI flag. Add an op's descriptor there when a doc starts
naming it.

A change here reaches users with the next difyctl build.
