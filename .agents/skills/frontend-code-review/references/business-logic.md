# Rule Catalog — Business Logic

## Can't use workflowStore in Node components

IsUrgent: True

### Description

File path pattern of node components: `web/app/components/workflow/nodes/[nodeName]/node.tsx`

Node components are also used when creating a RAG Pipe from a template, but in that context there is no workflowStore Provider, which results in a blank screen. [This Issue](https://github.com/langgenius/dify/issues/29168) was caused by exactly this reason.

### Suggested Fix

Use `import { useNodes } from 'reactflow'` instead of `import useNodes from '@/app/components/workflow/store/workflow/use-nodes'`.

## Locale keys must be complete

IsUrgent: True
Category: Business Logic

### Description

When adding or changing user-facing i18n keys, ensure every supported locale file has the same key set as `web/i18n/en-US/`. Do not add only English keys or only a partial subset of locales; `pnpm i18n:check --file <name>` should pass for the touched translation file.

### Suggested Fix

Add matching keys to every existing supported locale file for the touched translation namespace, keeping key paths aligned with the English entry.

## Preserve behavior-sensitive interactions

IsUrgent: True
Category: Business Logic

### Description

When changing existing navigation, sidebar, dropdown, webapp list, or app-switching UI, compare behavior against the existing implementation before approving the change. Watch for regressions in expand/collapse arrows, hover persistence, pin/delete controls, routing, keyboard/focus handling, and open-state ownership.

### Suggested Fix

Reuse or extend the existing component when it already owns the interaction logic. If a refactor is needed, preserve the old interaction contract and add or update focused tests for the changed behavior.
