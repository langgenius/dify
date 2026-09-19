# Development principles: naming

Every file, function, class, method, and variable must use simple, concrete, human-readable words. A reader should understand what a name refers to without knowing the implementation or its design history.

- Name the actual thing, action, or result. Abstract concepts are prohibited as names: do not hide a specific responsibility behind words such as `facade`, `coordinator`, or `context`.
- Use nouns for things and verbs for actions. Include the object of an action when it would otherwise be unclear.
- Use the same word for the same thing across files and callers. Distinguish different things explicitly, such as `tenant_id`, `app_id`, and `workflow_run_id`.
- Avoid vague names and invented abbreviations. Follow the language's casing conventions and the project's established technical abbreviations.

| Kind | Unclear name | Concrete name |
| --- | --- | --- |
| File containing message delivery code | `runtime_facade.py` | `message_delivery.py` |
| Function loading a tenant's settings | `resolve_context()` | `load_tenant_settings()` |
| Class representing a trace delivery | `DataCarrier` | `TraceDelivery` |
| Method sending pending traces | `process()` | `send_pending_traces()` |
| Variable containing message text | `payload` | `message_text` |

Preserve identifiers required by external APIs, protocols, persisted formats, and framework interfaces. Use concrete names in the code surrounding those boundaries; do not break compatibility to rename an external identifier.

At the end of each implementation cycle, review the names in changed code and affected callers. Correct unclear names and update their imports, call sites, and documentation before considering the work complete. Keep unrelated renames outside the change.
