# Plugin Readme reading

The panel owns Readme loading, empty and error presentation. Its store owns the
selected plugin and drawer/dialog session, while TanStack Query owns the fetched
text and binary resources.

## API and type ownership

The Console `PluginReadmeApi` and `PluginAssetApi` controllers in
`api/controllers/console/workspace/plugin.py` own the public HTTP contracts.
`PluginReadmeResponse` contains `readme: string`; `BinaryFileResponse` is generated
as `Blob | File`. The backend adapts the daemon's Readme content to the Console
response. A successful empty string and a failed request are distinct outcomes:
the panel displays its empty state for the former and its failure state for the
latter.

Consume `consoleQuery.workspaces.current.plugin.readme.get` and
`consoleQuery.workspaces.current.plugin.asset.get` directly. Keep the generated
responses in the cache; do not mirror their types or cache object URLs.

## Query and display decisions

| Operation      | Shared policy                                                         | Consumer-owned input and presentation                                                                               |
| -------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Readme text    | Silent transport errors; no retries; normal client freshness          | Complete plugin unique identifier and model-language value; loading, empty and failure presentation                 |
| Local resource | Silent transport errors; normal client freshness and observer retries | Complete plugin unique identifier and normalized asset filename; marketplace image fallback and object URL lifetime |

The normal browser client freshness is five minutes. A missing required input
uses `skipToken`. Text identity includes the language; asset identity includes
the normalized filename. Both include the full plugin identifier, so changing
plugin versions selects a different cache entry.

Readme requests retain the existing model-language mapping (`en_US`, `zh_Hans`,
and other locale values with an underscore). Display metadata uses its separate
plugin-language fallback. Do not interchange these mappings or switch Readme
requests to the backend's default language as part of a query migration.

Markdown resource consumers own eligibility and filename normalization for
`./_assets` and `_assets` references. Ordinary external image URLs use the existing
Markdown fallback without a Console asset request. Each mounted image consumer
creates its own object URL from the cached binary and releases it on replacement
or unmount. A changed resource must not display a URL owned by the previous
resource or retain its image-preview session.

Both endpoints read plugin package content. They do not mutate installation,
permissions, or catalog state, so they add no mutation invalidation. Workspace
switching remains the existing full-document reload boundary. This module does
not own installation-task polling, plugin settings, or general Markdown rendering.

## Verification boundary

Exercise the production consumers with generated queries and an intercepted HTTP
boundary. Cover text states and locale/version isolation, resource admission and
fallback, and replacement/unmount cleanup. Browser verification must also prove
that the actual binary response produces a decodable image and that switching
resources restores the current image after an earlier image failed.
