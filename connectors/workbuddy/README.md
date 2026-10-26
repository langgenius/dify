# Connectors

One folder per platform, then one folder per connector. Each connector folder holds the files that platform needs, plus the script here packages them with the repo skill.

## WorkBuddy

Package a connector:

```sh
git fetch --tags origin
node connectors/workbuddy/package.ts difyctl            # newest stable tag
node connectors/workbuddy/package.ts difyctl --tag 1.18.0
```

The zip is written to `connectors/workbuddy/build/<connector>.zip`. The script prints the tag it used.

- `skill-meta.json` holds the skill header fields only WorkBuddy reads. The script adds them to the packaged `SKILL.md`. Keep them out of the skill in `skills/`.
- Bump `version` in `connector-meta.json` on every submission.
- Upload the zip on the WorkBuddy open platform: https://open.workbuddy.cn
- If parsing fails, contact openworkbuddy@tencent.com.
