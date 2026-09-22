# Infotip

Use `Infotip` when an information icon's primary action is opening an explanation. Use
`Tooltip` for a supplementary visual label on a control with another primary action.
Text length alone does not determine the component; see [Base UI's infotip guidance].

## Composition and naming

Compose `Infotip`, `InfotipTrigger`, and `InfotipContent` from `@langgenius/dify-ui/infotip`.
Props derive from Base UI Popover. Trigger owns a native icon button; Content owns the portal
and hint surface. Base UI owns the dialog role, expanded state, focus, and dismissal.

The icon-only Trigger requires exactly one of `aria-label` or `aria-labelledby` in TypeScript.
Content keeps Base UI Popup props: its dialog needs a name, but that name can come from an
associated title rather than an explicit `aria-label`. Visible body text alone [does not name a dialog].
Prefer a short visible topic owned by the field or section, and keep the explanation in the body:

```tsx
function ProcessingHint() {
  const labelId = useId()

  return (
    <div className="flex items-center gap-1">
      <span id={labelId}>Document processing</span>
      <Infotip>
        <InfotipTrigger aria-labelledby={labelId} />
        <InfotipContent aria-labelledby={labelId}>
          Documents are processed in the order they are received.
        </InfotipContent>
      </Infotip>
    </div>
  )
}
```

- The trigger's label must exist while closed. If a heading only exists inside the popup,
  reference it from Content and give Trigger its own short name.
- Without a suitable visible label, use a short localized `aria-label`. Sharing a short topic
  between the button and dialog is valid; copying the whole explanation into both is not.
- Do not extract names from React children, add redundant hidden headings, or automatically
  describe the popup with its entire body. Links and structured content remain navigable.
- Callers own wording and valid label references; follow [Accessible names and descriptions].

## Visual ownership

Infotip shares Tooltip's hint surface. Border, background, padding, typography, radius, and
shadow belong to the primitive. Callers may constrain width and preserve intentional line
breaks under the lint contract. The trigger supports hover, click, touch, and keyboard access.

[Accessible names and descriptions]: ../../docs/accessible-names-and-descriptions.md
[Base UI's infotip guidance]: https://base-ui.com/react/components/tooltip#infotips
[does not name a dialog]: https://www.w3.org/TR/wai-aria-1.2#dialog
