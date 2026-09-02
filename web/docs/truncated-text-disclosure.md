# Truncated Text Disclosure

Treat native `title` as an opt-in, supplemental product behavior. Do not treat it as a mechanical companion to `truncate`, `text-overflow`, or `line-clamp-*`.

Missing `title` is not by itself an accessibility defect. Native title tooltips must not:

- be the only way to access essential information;
- replace a visible label, accessible name, or accessible description;
- compete with an existing hover, focus, pointer, expand, copy, or detail interaction.

Before making a change:

1. Trace the value to the final rendered DOM element.
2. Identify the existing owner of full-content disclosure.
3. Classify the candidate as `AUTO`, `COVERED`, `SKIP`, or `REVIEW`.
4. Modify only `AUTO` candidates. Report the others without changing code.

## AUTO

Automatically add `title` only when every condition below is satisfied:

- The target is a native, non-editable, pointer-reachable text container whose own hit area receives the pointer, or a documented component that forwards `title` unchanged to that final DOM element.
- The final element intentionally implements single-line truncation. A truncation-related class alone is not sufficient evidence.
- The full content is a bounded, non-sensitive, single-line plain string.
- “Bounded” means fixed text, an enum, or a value with an explicit owner-level maximum length.
- The exact already-evaluated display value can be reused without repeating a function call, getter, conversion, mutation, async operation, or other potentially effectful expression.
- The final rendered element does not already receive an equivalent title through its props, wrapper, child component, or covering interaction target.
- No Tooltip, PreviewCard, Popover, expandable content, “show more” action, detail view, copy/reveal action, or other full-content owner exists.
- The native tooltip will not compete with another hover, focus, pointer, or keyboard interaction.

## COVERED

Classify as `COVERED` and make no change when another component or interaction already owns full-content disclosure, including:

- Tooltip, PreviewCard, or Popover;
- expandable or “show more” content;
- a detail view opened from the current surface;
- a copy or reveal action;
- a parent or covering interaction target that already provides the equivalent title.

## SKIP

Classify as `SKIP` and make no change when any condition below applies:

- The value contains or may contain a secret, token, API key, password, credential, or other sensitive data.
- The value is unbounded user content, multiline content, a comment, prompt, generated output, log body, or another potentially large string.
- The visible content is JSX, `ReactNode`, structured content, or would require a stringification helper.
- Producing the title would repeat or relocate evaluation of a function call, getter, conversion, mutation, async operation, or other potentially effectful expression.
- The element is an input, textarea, editable surface, `pointer-events-none`, covered by another element, or not the actual pointer target.
- An existing `title`, including `title=""`, would need to be overwritten or removed.
- The content uses `line-clamp-*` and already has an expand or detail interaction.

## REVIEW

Classify as `REVIEW`, make no code change, and report the reason when:

- the correct disclosure owner is ambiguous or product-specific;
- the value bound or sensitivity cannot be proven;
- the final DOM element or pointer owner cannot be traced;
- the component is interactive;
- the content uses `line-clamp-*` without an existing full-content path;
- actual truncation or the intended product behavior cannot be established from the owner contract.

Before adding `title` to a custom component, inspect its implementation and trace the prop to the final DOM element. A `value`, `label`, or similar prop may already provide the native title; do not add a duplicate at the call site.

Do not introduce:

- a repository-wide missing-title lint error;
- a mass autofix or migration;
- a `ReactNode`-to-string helper;
- suppressions for candidates outside the allowlist.

Test the feature-owned disclosure behavior through its public interface. Assert native `title` only when it is an explicitly accepted product contract. Do not use `getByTitle` or `toHaveAttribute('title', ...)` merely to prove a migration, and do not use title-based selectors to test unrelated interactions.
