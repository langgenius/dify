# Workspace skills

A workspace skill is a folder with a `SKILL.md` at its root, plus any files it uses. Skills have a draft and published versions. Import writes the draft. Agents use only what is published.

## Find a skill

1. `difyctl get skill` lists the skills in the workspace.
2. `difyctl describe skill --skill-id <skill_id>` shows one skill. Keep its `draft_hash`. `latest_version` is null while the skill has never been published.
3. `difyctl get skill version --skill-id <skill_id>` lists the published versions.

## Create a skill

1. Put the skill in a folder with `SKILL.md` at its root. `name` and `description` in its frontmatter are required.
2. `difyctl import skill --files <dir>`
3. `difyctl publish skill --skill-id <skill_id>`. Import never publishes. Use the `skill_id` from the import result.

A name already taken gives 409 `skill_name_conflict`. Its hint is an import with `--skill-id` set to the skill that has the name. Use it only if the human wants to replace that skill. If another import took the name a moment earlier, the server does not know that skill's id, so the hint is `difyctl get skill --keyword <name>` instead. Take the id from that list.

## Change a skill

1. `difyctl describe skill --skill-id <skill_id>` and keep `draft_hash`.
2. `difyctl export skill --skill-id <skill_id> --output <name>.zip` saves the draft as a zip.
3. Unzip into a new, empty folder: `unzip -q <name>.zip -d <dir>`, or `python3 -m zipfile -e <name>.zip <dir>`, or on Windows `tar -xf <name>.zip -C <dir>`.
4. Edit the files in the folder.
5. `difyctl import skill --files <dir> --skill-id <skill_id> --draft-hash <draft_hash>`
6. `difyctl publish skill --skill-id <skill_id>`

Leaving out `--draft-hash` on an overwrite skips the conflict check, so the import replaces whatever the draft holds now.

The folder replaces the whole draft. A file you leave out of the folder is deleted from the draft.

If step 5 gives 409, someone changed or published the skill since you took the hash. Run steps 1 to 4 again and redo your edits on the new export.

## Read what is live

Export the published version, not the draft: `difyctl export skill --skill-id <skill_id> --version-id <version_id>`. Take `<version_id>` from `latest_version.id` in the `describe skill` result.

## Roll back

1. Pick the version with `difyctl get skill version --skill-id <skill_id>`.
2. Export it with `--version-id`, unzip it, and import the folder with `--skill-id` and the current `--draft-hash`.
3. Publish.

## Rules

- `name` in `SKILL.md` must equal the name of the skill you overwrite. A different name gives 400.
- Import takes a folder, never a zip.
- `.DS_Store`, `Thumbs.db`, `desktop.ini` and `__MACOSX` entries are dropped.
- `draft_hash` has one-second resolution. Two edits in the same second are not told apart.
- A folder over the server's file count or size limit gives 413 and the message names the limit. Don't assume the numbers; trim the folder to fit what the message says.
