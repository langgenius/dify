# Truncated Text Disclosure

Treat native `title` as an opt-in, supplemental product behavior. Do not treat it as a mechanical companion to `truncate`, `text-overflow`, or `line-clamp-*`.

Browser-rendered title tooltips are exempt from the author-controlled hover and focus behavior in [WCAG 1.4.13], but that exception is not an accessibility endorsement. [MDN] documents unreliable access for touch, keyboard, and assistive-technology users. The classifications below decide whether to add `title`; they do not establish WCAG conformance for the surrounding interaction.

Missing `title` is not by itself an accessibility defect. Native title tooltips must not:

- be the only way to access essential information;
- replace a visible label, accessible name, or accessible description;
- compete with an existing hover, focus, pointer, expand, copy, or detail interaction.

For automated `title` additions, trace the displayed value, final DOM element, and existing disclosure owner. Apply `SKIP`, `COVERED`, `AUTO`, and `REVIEW` in that order; add `title` only for `AUTO` candidates.

These classifications limit automatic `title` additions. For a requested disclosure fix, continue with the appropriate feature-owned interaction. `REVIEW` calls for resolving the disclosure design; it does not require stopping an already authorized fix or asking for approval of routine implementation choices.

## AUTO

Automatically add `title` only when every condition below is satisfied:

- The target is a native, non-editable, pointer-reachable text container whose own hit area receives the pointer, or a documented component that forwards `title` unchanged to that final DOM element.
- The final element intentionally implements single-line truncation. A truncation-related class alone is not sufficient evidence.
- The full content is a bounded, non-sensitive, single-line plain string.
- The truncated portion is supplemental; users do not need it to understand, distinguish, or complete the current task.
- “Bounded” means fixed text, an enum, or a value with an explicit owner-level maximum length.
- The exact already-evaluated display value can be reused without repeating a function call, getter, conversion, mutation, async operation, or other potentially effectful expression.
- The final rendered element does not already receive an equivalent title through its props, wrapper, child component, or covering interaction target.
- No Tooltip, Popover, expandable content, “show more” action, detail view, copy/reveal action, or other full-content owner exists. A PreviewCard counts only under the `COVERED` rule below.
- The native tooltip will not compete with another hover, focus, pointer, or keyboard interaction.

## COVERED

Classify as `COVERED` and make no change when the full content is already available through the current content, an accessible interaction, or a linked destination. An overlay is not automatically a disclosure owner:

- a Tooltip only when it duplicates non-essential full text already available from its trigger's readable text or accessible name;
- a [PreviewCard] whose trigger is a real destination link and whose destination contains the equivalent full content; the preview popup itself is only a visual enhancement, not the disclosure owner;
- a Popover that exposes the full content through pointer, keyboard, touch, and assistive technology;
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

## REVIEW

Classify a proposed automatic `title` addition as `REVIEW` and explain the unresolved disclosure requirement when:

- the correct disclosure owner is ambiguous or product-specific;
- users need the full value to understand, distinguish, or complete the task, but no cross-input disclosure owner exists;
- the value bound or sensitivity cannot be proven;
- the final DOM element or pointer owner cannot be traced;
- the component is interactive;
- Tooltip or PreviewCard content would be the only path to the full content, or a PreviewCard trigger is not a destination link;
- a Popover or other disclosure cannot be reached across pointer, keyboard, touch, and assistive technology;
- the content uses `line-clamp-*` without an existing full-content path;
- actual truncation or the intended product behavior cannot be established from the owner contract.

Before adding `title` to a custom component, inspect its implementation and trace the prop to the final DOM element. A `value`, `label`, or similar prop may already provide the native title; do not add a duplicate at the call site.

Do not introduce:

- a repository-wide missing-title lint error;
- a mass autofix or migration;
- a `ReactNode`-to-string helper;
- suppressions for candidates outside the allowlist.

Test the feature-owned disclosure behavior through its public interface. Assert native `title` only when it is an explicitly accepted product contract. Do not use `getByTitle` or `toHaveAttribute('title', ...)` merely to prove a migration, and do not use title-based selectors to test unrelated interactions.

[MDN]: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/title#accessibility_concerns
[PreviewCard]: ../../packages/dify-ui/docs/overlays.md#primitive-semantics
[WCAG 1.4.13]: https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html
