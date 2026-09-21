# difyctl skills

Agent skills shipped with the difyctl CLI. The CLI embeds this folder at build
time (`pnpm skills:gen` in `cli/`) and installs the skills with
`difyctl skills install <dir>`. The same files install unchanged through the Vercel
installer: `npx skills add langgenius/dify --skill difyctl -g`.

## Adding a skill

- One folder per skill: `difyctl` is the base skill, scenario skills are
  `difyctl-<scenario>`.
- `SKILL.md` frontmatter has `name` (equal to the folder name) and
  `description`. The description says when to use the skill; the base skill
  quotes it.
- Plain markdown only. No placeholders, no HTML comment markers, no scripts.
  Optional `references/*.md` beside the `SKILL.md`. Only `*.md` files are
  embedded.
- A scenario skill opens with: Read `../difyctl/SKILL.md` first.
- Every `difyctl <command>` named in backticks must exist in the command tree.
  Every op id after `call` or `ops describe` must exist in
  `cli/test/fixtures/catalog.json`.
- List every scenario skill in the base skill's "Other skills" section.

Run `pnpm skills:gen` in `cli/` after any change here and commit the generated
`cli/src/skills/collection.generated.ts`.
