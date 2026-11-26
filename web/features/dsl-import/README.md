# DSL Import UI

Import UI shared by application creation, workflow replacement, knowledge
pipeline replacement, and Snippet import.

| Development task                                    | Public entrypoint           |
| --------------------------------------------------- | --------------------------- |
| Select, validate, display, or remove an import file | [`uploader.tsx`]            |
| Display distinct import warnings and their fallback | [`warning-description.tsx`] |

The uploader owns file-picker, drag/drop, extension validation, and focus
behavior. Consumers own the selected file, pending state, permissions, quotas,
import requests, version confirmation, and navigation. Warning presentation
accepts messages and a consumer-owned fallback.

Keep dependencies directed from the consuming workflows to this module.
Import the public files directly so file selection does not load a creation
dialog or an import request controller.

From `web/`, run:

```sh
vp test run --project unit features/dsl-import
```

[`uploader.tsx`]: uploader.tsx
[`warning-description.tsx`]: warning-description.tsx
