# Dify Plugin Development Guide

Welcome to Dify plugin development! This guide will help you get started quickly.

## Setup

### Requirements

- Python 3.11+
- Dependencies: `pip install -r requirements.txt`

## Development Process

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

## Publishing

```bash
dify plugin package ./YOUR_PLUGIN_DIR
```

