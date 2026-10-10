# difyctl skills

Agent skills for the difyctl CLI. They use the standard Agent Skills layout: one
folder per skill, each with a `SKILL.md`. There is no index to maintain.

`difyctl install skills <dir>` downloads them from GitHub at install time, from
the commit that difyctl was built from. `--from` points at any GitHub folder
with the same layout, or at a local folder. The same files install through the
Vercel installer: `npx skills add langgenius/dify --skill difyctl -g`.

## Adding a skill

- One folder per skill: `difyctl` is the base skill, scenario skills are
  `difyctl-<scenario>`.
- `SKILL.md` frontmatter has `name` (equal to the folder name: lowercase
  letters, digits, dashes) and `description`. The description says when to use
  the skill; the base skill quotes it.
- Any files may sit beside `SKILL.md`: `references/`, `scripts/`, `assets/`.
  Commit scripts as executable (`chmod +x`); the installer keeps the bit.
- A scenario skill opens with: Read `../difyctl/SKILL.md` first.
- Every `difyctl <command>` named in backticks must exist in the command tree.
  Every dotted op id must exist in `cli/test/fixtures/catalog.json`.
- List every scenario skill in the base skill's "Other skills" section.

A change here reaches users with the next difyctl build. Anyone can get it
sooner with `--from https://github.com/langgenius/dify/tree/main/skills`.
