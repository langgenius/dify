# WorkBuddy connectors

This folder holds the connectors for WorkBuddy. Each connector has its own subfolder with the files WorkBuddy needs. The script here packages a connector with the repo skill into a zip.

## Package a connector

Needs git, tar, zip and Node 22.18 or newer (to run `.ts` files directly).

```sh
git fetch --tags origin
node connectors/workbuddy/package.ts dify-mcp                  # newest stable tag
node connectors/workbuddy/package.ts dify-mcp --tag <release>  # a given release tag
node connectors/workbuddy/package.ts dify-mcp --worktree       # skill from the working tree, no tag
```

The zip is written to `connectors/workbuddy/build/<connector>.zip`. The script prints the tag it used, or `worktree` with `--worktree`; check it is the source you expect. `--tag` and `--worktree` cannot be combined. The script fails when a relative link in `skill-intro.md` points to a file the skill does not have, or when the zip is over WorkBuddy's 20 MB limit. The tag must be a release that contains the MCP flow (`skills/difyctl/references/mcp.md`). Older tags build a package whose intro points at a missing file.

Use `--worktree` for a test build before a release, so the zip contains skill changes that no tag has yet. Packages submitted to WorkBuddy are always built from a release tag, never with `--worktree`.

## What the user needs

- A Dify release that includes the `/openapi/v1/mcp` endpoint.
- `OPENAPI_ENABLED=true` on the Dify server.
- The Dify host name. WorkBuddy always connects to `https://<host>/openapi/v1/mcp` on port 443 and cannot take a port, so the server must be reachable over HTTPS on 443.
- A personal access token (prefix `dpat_`, recommended) or a workspace access token. The token's app access decides which apps the agent can find and run. Workspace access is needed for plugins, model providers and tool credentials. A personal token can find and run the apps chosen for the token, answer human-input forms, and manage plugins, model providers and tool credentials. A workspace token can list and run apps, but cannot answer a human-input pause and cannot reach plugins, model providers or tool credentials.

An agent whose shell can reach the Dify server can send a local file as a run input: it calls `prepare.upload` and runs the command it returns. Skill operations refuse personal and workspace tokens, so with these tokens their files stay out of reach. A URL in an app's inputs still works. A bad token gets a 401, and WorkBuddy then asks the user to reconnect.

## Notes

- An MCP connector ships `connector-meta.json`, `mcp.json` and `icon.png`, plus `token-schema.json` when `auth_mode` is `token`.
- `skill-meta.json` holds the skill header fields only WorkBuddy reads. The script adds them to the packaged `SKILL.md`. Keep them out of the skill in `skills/`. Its `skill` names the folder in `skills/` to ship, and `name` is the skill's name inside the package; the script renames the folder and the `name` in `SKILL.md` to it.
- `skill-intro.md` (optional) is text only for this connector's agent, such as how to log in. The script inserts it at the top of the packaged `SKILL.md` body.
- Bump `version` in `connector-meta.json` on every submission.
- Upload the zip on the WorkBuddy open platform: https://open.workbuddy.cn
- If parsing fails, contact openworkbuddy@tencent.com.
