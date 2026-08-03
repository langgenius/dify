export const knowledgeFsAgentGuide = `
WORKFLOW
  Each KnowledgeFS filesystem command is an independent difyctl command and
  OpenAPI operation:
    difyctl knowledge fs ls <space-id> /knowledge
    difyctl knowledge fs tree <space-id> /knowledge --depth 2
    difyctl knowledge fs cat <space-id> /knowledge/docs/readme.md
    difyctl knowledge fs grep <space-id> TODO /knowledge
    difyctl knowledge fs find <space-id> /knowledge --name-contains readme
    difyctl knowledge fs stat <space-id> /knowledge/docs/readme.md
    difyctl knowledge fs diff <space-id> /knowledge/old.md /knowledge/new.md

PAGINATION
  ls, tree, grep, and find default to --limit 20. If a response contains
  next_page_token, repeat the same command with --cursor <value>. The token is
  opaque: do not inspect or modify it.

OUTPUT
  cat prints file text by default. Other commands print their structured
  response. Use -o json or -o yaml for a stable machine-readable envelope.

ERROR RECOVERY
  not logged in          difyctl auth login
  workspace required     pass -w <workspace-id> or run difyctl use workspace <id>
  invalid path           use /knowledge, /workspaces, /sources, or /evidence
  path not visible       verify the knowledge-space id and your workspace access
`
