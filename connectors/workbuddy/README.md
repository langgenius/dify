# WorkBuddy connectors

This folder holds the connectors for WorkBuddy. Each connector has its own subfolder with the files WorkBuddy needs. The script here packages a connector with the repo skill into a zip.

## Package a connector

Needs git, tar, zip and Node 22.18 or newer (to run `.ts` files directly).

```sh
git fetch --tags origin
node connectors/workbuddy/package.ts difyctl            # newest stable tag
node connectors/workbuddy/package.ts difyctl --tag 1.18.0
```

The zip is written to `connectors/workbuddy/build/<connector>.zip`. The script prints the tag it used.

## Run the tests

```sh
node --test connectors/workbuddy/lib.test.ts
```

## Notes

- `skill-meta.json` holds the skill header fields only WorkBuddy reads. The script adds them to the packaged `SKILL.md`. Keep them out of the skill in `skills/`.
- Bump `version` in `connector-meta.json` on every submission.
- Upload the zip on the WorkBuddy open platform: https://open.workbuddy.cn
- If parsing fails, contact openworkbuddy@tencent.com.
