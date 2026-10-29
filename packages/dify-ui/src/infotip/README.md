# Infotip

Use `Infotip` when an information icon's primary action is opening an explanation. Use
`Tooltip` when the trigger already has another primary action and only needs a visual hint.

## Naming

Prefer an existing visible topic. It can name both the trigger and the dialog:

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

If the popup has its own visible title, use `InfotipTitle`. It gives the dialog its accessible name:

```tsx
<Infotip>
  <InfotipTrigger aria-label="Processing priority" />
  <InfotipContent>
    <InfotipTitle>Processing priority</InfotipTitle>
    <p>Priority determines which documents are processed first.</p>
  </InfotipContent>
</Infotip>
```

Keep explanations, links, and other structured content as normal popup children rather than
turning the whole body into the dialog description.

A few rules:

- The trigger's name must exist while the popup is closed.
- Prefer `aria-labelledby` when a suitable visible topic already exists; otherwise use a short
  localized `aria-label`.
- Sharing one short topic between the trigger and dialog is valid. Do not copy the full explanation
  into their accessible names.
- Do not derive names from React children or automatically describe the dialog with its entire body.

## Visual ownership

Infotip owns its hint surface, spacing, typography, radius, and shadow. Callers may constrain width
or preserve intentional line breaks.
