# Workflow Template Extraction

This helper turns real exported Dify workflows into reusable plugin-node template files.

## Why

It is the fastest way to "learn" your team's real workflow patterns without hand-copying every node shape.

## Usage

```bash
python3 dify/scripts/dsl_generator/extract_templates_from_workflows.py \
  /Users/scarlettmao/Desktop/dify-workflows/workflows
```

## What it does

- scans exported workflow `.yml` files
- extracts reusable plugin nodes into `templates/extracted/`
- keeps node `data`, `width`, and `height`
- tries to attach node-level `dependencies`
- writes an inventory file for review
- clears the output directory before extraction unless `--no-clean` is used

## Current extraction focus

By default it only extracts plugin-backed workflow nodes:

- `tool`
- `trigger-plugin`

This keeps the template library focused on the hardest part of generation:

- plugin identity
- dependency wiring
- node skeletons that are difficult to hand-write

It also clears obvious user-editable values from plugin parameters so the result is closer to an importable skeleton than a business-specific copy.
