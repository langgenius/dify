## SERP

**Author:** acedatacloud  
**Type:** tool provider plugin  
**API:** `https://api.acedata.cloud/serp/google`

### What it does

This plugin integrates **Ace Data Cloud Google SERP API** as a Dify tool for:

- Fetching structured Google search results (search/images/news/maps/places/videos)

### Tools

- `serp_google`
  - Inputs: `query` (required), `type`, `country`, `language`, `range`, `number`, `page`
  - Outputs: `success`, `trace_id`, `data`, `error`

### Credentials

Requires `acedata_bearer_token` (paste the token without the `Bearer ` prefix).

### Packaging

```bash
dify plugin package plugins/serp -o serp.difypkg
```

