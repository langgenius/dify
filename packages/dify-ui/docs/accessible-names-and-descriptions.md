# Accessible Names and Descriptions

This cross-component contract is owned by Dify UI. It applies to Dify UI primitives and to
consumers composing those primitives. It depends only on Dify UI component contracts and upstream
web standards; application packages may add localization, testing, and product-specific rules
without redefining this contract.

[Base UI accessibility] owns the primitive mechanics it implements, such as roles, relationships,
keyboard interaction, and focus management. Dify UI and its consumers still own the final element,
label content, composition, and product meaning. Use this guide to choose those naming and
description sources. Open a component guide only when the decision reaches that component.

## Start Here

An accessible name identifies a control or region. An accessible description adds optional help,
instructions, or consequences. State such as checked, expanded, or disabled remains on the control,
and changing status remains with the feature's status or live-region owner.

For each changed element:

1. Inspect the final rendered element, role, text, and props forwarded by its primitive.
1. Prefer meaningful visible text or a native label relationship.
1. Use `aria-labelledby` when suitable visible text exists elsewhere in the DOM.
1. Use `aria-label` only when the role permits naming and no visible text can provide the name.
1. Add `aria-describedby` only for useful supplemental text; do not repeat the name.
1. Verify the computed name and description in every changed responsive and interaction state.

These choices follow the [W3C APG naming techniques][apg] and [MDN `aria-label` guidance]. Nearby
text is not a label relationship by proximity alone.

## Common Decisions

| Surface                    | Contract                                                                                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Text button or link        | Follow [Button]. Let meaningful child text name the action; do not repeat it in `aria-label`.                                                      |
| Form control               | Follow [Forms]. Use its label primitive or an associated native `label`, preserving label activation.                                              |
| Icon-only command          | Follow [IconButton]. Its component-specific contract requires one accessible-name source and a decorative glyph.                                   |
| Dialog or named region     | Reuse the visible title through the primitive title API or `aria-labelledby`; use `aria-label` only when no suitable visible title exists.         |
| Related form-control group | Follow [Forms]. Use `Fieldset` with `FieldsetLegend` and preserve each control's own label. Other composite widgets follow their owning primitive. |
| Table or figure            | Prefer `caption` or `figcaption` when appropriate. See the [APG caption guidance][captions] for name and description differences.                  |
| Image                      | Supply meaningful `alt`, or `alt=""` for a decorative image.                                                                                       |
| Plain `div` or `span`      | Keep readable content; do not add `aria-label` or `aria-labelledby` to the default `generic` role.                                                 |

Naming permission comes from semantics, not the presence of an `aria-*` prop. Other roles also
prohibit naming. Do not invent a role merely to permit a label. A plain span may contain text
referenced by another element's `aria-labelledby`; that relationship names the referencing element,
not the span. Check [ARIA in HTML][html-naming] for restrictions on the final element.

## Names, Descriptions, and State

A description is optional when the name is sufficient. For a file action, the name might identify
the operation and file, while the description explains retention or recovery. Avoid repeating the
same sentence in both. See the [name and description computation specification][accname].

A name or description attribute is not an announcement mechanism. Keep progress and asynchronous
updates with their existing feature owner. Follow [Button] for loading behavior and [Forms] for
field error relationships.

## Overrides and References

Authoring preference differs from computation priority. A resolving `aria-labelledby` takes
precedence over `aria-label` and normal native or content naming. An empty referenced label can
leave the name empty. A non-empty `aria-label` also overrides normal native or content naming;
these sources are not concatenated. See the [computation steps][computation].

- With `aria-labelledby`, reference the intended text directly. Multiple IDs are read in attribute
  order; do not build chains of elements that each use `aria-labelledby`.
- Overriding a button or link's content-derived name can suppress meaningful descendant content in
  its accessible representation. Preserve the necessary visible wording in the resulting name.
- Inspect IDs generated by primitives before overriding them. Keep IDs unique across repeated rows
  and simultaneous dialogs, and ensure referenced nodes exist in relevant open, closed, and
  responsive states. Preserve existing description IDs when adding another relationship.
- Do not use `title`, `placeholder`, or Tooltip content as the only naming source. Native `title`
  does not replace an intentional name or description relationship.

## Write Useful Names

Keep the visible label's wording in the accessible name, preferably at the beginning. Add target
context when identical visible actions would otherwise be ambiguous. Matching visible words also
lets speech-input users invoke what they see. See [WCAG Label in Name][label-in-name].

Use concise action or purpose wording. Avoid appending role words already announced by assistive
technology or duplicating state exposed by the control. Consumers own localization and pass the
complete localized text through public props or children; Dify UI primitives do not import
application i18n.

The following fragment assumes localized strings and owner-scoped unique IDs. It combines the
visible action with the file it affects:

```tsx
<>
  <span id={fileNameId}>{fileName}</span>
  <Button aria-labelledby={`${deleteLabelId} ${fileNameId}`}>
    <span id={deleteLabelId}>{deleteLabel}</span>
  </Button>
</>
```

## Associate Descriptions

Use `aria-describedby` to associate concise help or consequences with a named control. The
referenced content becomes a plain string: headings, lists, and interactive links do not retain
their structure in the description. Keep rich instructions reachable as normal content or through
the [Overlay] contract. `aria-details` may supplement structured content where supported; it does
not replace that reachable content. See [MDN `aria-describedby` guidance][describedby].

In Dify fields, compose `FieldDescription` and `FieldError` with the appropriate label and control.
These primitives own their relationships, including invalid-state feedback. Do not overwrite them
with a second label or a competing error association:

```tsx
<Field name="fileName">
  <FieldLabel>{fileNameLabel}</FieldLabel>
  <Input required />
  <FieldDescription>{formatHint}</FieldDescription>
  <FieldError match="valueMissing">{requiredMessage}</FieldError>
</Field>
```

Use `DialogTitle` and, when useful, `DialogDescription` for a short dialog summary. Do not turn a
whole form or rich dialog body into one description. Per [Base UI Tooltip guidance], Tooltip is a
supplemental visual label for a trigger that already has an accessible name; use [Overlay] choices
for essential, structured, interactive, or touch-reachable information.

Prefer descriptions associated with DOM text. When considering `aria-description`, verify target
browser and assistive-technology behavior. The [AccName 1.2 working draft] gives
`aria-describedby` precedence over `aria-description`, followed by applicable native description
sources and unused `title` fallback. Do not stack mechanisms to force repeated output.

## Hidden Text and Safe Removal

- `sr-only` hides text visually while retaining it for assistive technology. It can contribute to
  a content-derived name or serve as a referenced label or description. A standalone span does not
  name a sibling control, and `sr-only` is not an automatic replacement for `aria-label`.
- `hidden`, `display: none`, `visibility: hidden`, and `aria-hidden="true"` normally exclude content
  during name calculation. Explicitly referenced hidden nodes can still contribute; inspect the
  reference and its subtree instead of assuming all hidden text is ignored. See the [computation
  steps][computation] and [description reference][describedby].
- Before removing a label, inspect the resulting name and description in collapsed navigation,
  responsive icon-only layouts, loading, and disabled states. CSS truncation alone does not remove
  underlying text. Preserve primitive relationships and necessary status information. Add hidden
  text only when information would otherwise be missing.
- Verify observable names, descriptions, and keyboard behavior at the changed boundary. Follow the
  test policy owned by that package or consumer. Dify UI changes follow [Package testing]; complex
  overrides may also require inspecting the rendered accessibility tree and relevant screen-reader
  behavior.

[APG]: https://www.w3.org/WAI/ARIA/apg/practices/names-and-descriptions#namingtechniques
[AccName 1.2 working draft]: https://www.w3.org/TR/accname-1.2#mapping_additional_nd_description
[Base UI accessibility]: https://base-ui.com/react/overview/accessibility
[Base UI Tooltip guidance]: https://base-ui.com/react/components/tooltip#usage-guidelines
[Button]: ../src/button/README.md
[Forms]: forms.md
[IconButton]: ../src/icon-button/README.md
[MDN `aria-label` guidance]: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-label
[Overlay]: overlays.md
[Package testing]: testing.md
[accname]: https://www.w3.org/TR/accname-1.2#name_and_description
[captions]: https://www.w3.org/WAI/ARIA/apg/practices/names-and-descriptions
[computation]: https://www.w3.org/TR/accname-1.2#computation-steps
[describedby]: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-describedby
[html-naming]: https://www.w3.org/TR/html-aria#requirements-for-use-of-aria-attributes-to-name-elements
[label-in-name]: https://www.w3.org/WAI/WCAG22/Understanding/label-in-name.html
