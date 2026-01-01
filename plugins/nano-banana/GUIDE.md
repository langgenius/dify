# Dify Plugin Development Guide

Welcome to Dify plugin development! This guide will help you get started quickly.

## Plugin Types

Dify plugins extend three main capabilities:

| Type | Description | Example |
|------|-------------|---------|
| **Tool** | Perform specific tasks | Google Search, Stable Diffusion |
| **Model** | AI model integrations | OpenAI, Anthropic |
| **Endpoint** | HTTP services | Custom APIs, integrations |

You can create:
- **Tool**: Tool provider with optional endpoints (e.g., Discord bot)
- **Model**: Model provider only
- **Extension**: Simple HTTP service

## Setup

### Requirements
- Python 3.11+
- Dependencies: `pip install -r requirements.txt`

## Development Process

<details>
<summary><b>1. Manifest Structure</b></summary>

Edit `manifest.yaml` to describe your plugin:

```yaml
version: 0.1.0                  # Required: Plugin version
type: plugin                    # Required: plugin or bundle
author: YourOrganization        # Required: Organization name
label:                          # Required: Multi-language names
  en_US: Plugin Name
  zh_Hans: 插件名称
created_at: 2023-01-01T00:00:00Z # Required: Creation time (RFC3339)
icon: assets/icon.png           # Required: Icon path

# Resources and permissions
resource:
  memory: 268435456            # Max memory (bytes)
  permission:
    tool:
      enabled: true            # Tool permission
    model:
      enabled: true            # Model permission
      llm: true
      text_embedding: false
      # Other model types...
    # Other permissions...

# Extensions definition
plugins:
  tools:
    - tools/my_tool.yaml       # Tool definition files
  models:
    - models/my_model.yaml     # Model definition files
  endpoints:
    - endpoints/my_api.yaml    # Endpoint definition files

# Runtime metadata
meta:
  version: 0.0.1               # Manifest format version
  arch:
    - amd64
    - arm64
  runner:
    language: python
    version: "3.12"
    entrypoint: main
```

**Restrictions:**
- Cannot extend both tools and models
- Must have at least one extension
- Cannot extend both models and endpoints
- Limited to one supplier per extension type
</details>

<details>
<summary><b>2. Implementation Examples</b></summary>

Study these examples to understand plugin implementation:

- [OpenAI](https://github.com/langgenius/dify-plugin-sdks/tree/main/python/examples/openai) - Model provider
- [Google Search](https://github.com/langgenius/dify-plugin-sdks/tree/main/python/examples/google) - Tool provider
- [Neko](https://github.com/langgenius/dify-plugin-sdks/tree/main/python/examples/neko) - Endpoint group
</details>

<details>
<summary><b>3. Testing & Debugging</b></summary>

1. Copy `.env.example` to `.env` and configure:
   ```
   INSTALL_METHOD=remote
   REMOTE_INSTALL_URL=debug.dify.ai:5003
   REMOTE_INSTALL_KEY=your-debug-key
   ```

2. Run your plugin: 
   ```bash
   python -m main
   ```

3. Refresh your Dify instance to see the plugin (marked as "debugging")
</details>

<details>
<summary><b>4. Publishing</b></summary>

#### Manual Packaging
```bash
dify-plugin plugin package ./YOUR_PLUGIN_DIR
```

#### Automated GitHub Workflow

Configure GitHub Actions to automate PR creation:

1. Create a Personal Access Token for your forked repository
2. Add it as `PLUGIN_ACTION` secret in your source repo
3. Create `.github/workflows/plugin-publish.yml`

When you create a release, the action will:
- Package your plugin
- Create a PR to your fork

[Detailed workflow documentation](https://docs.dify.ai/plugins/publish-plugins/plugin-auto-publish-pr)
</details>

## Privacy Policy

If publishing to the Marketplace, provide a privacy policy in [PRIVACY.md](PRIVACY.md).