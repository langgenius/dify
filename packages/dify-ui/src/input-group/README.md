# Input Group

Use `InputGroup` when one text input shares a visual surface with a prefix, suffix, or action. Use
the standalone `Input` when no content shares that surface.

`InputGroup` is Dify UI's compound wrapper around [Base UI Input]. It owns the combined visual and
pointer surface without changing the input's native semantics.

## Anatomy

Compose exactly one direct `InputGroupInput` and one or more direct `InputGroupAddon` children:

```tsx
<InputGroup>
  <InputGroupInput aria-label="Repository URL" />
  <InputGroupAddon>https://</InputGroupAddon>
</InputGroup>
```

`InputGroup` owns the border, background, focus state, and non-interactive pointer surface.
`InputGroupInput` owns the native input and its value. Addons own layout and supporting content.
Do not absolutely position content over a standalone `Input` to recreate this shared surface.

Place `InputGroupInput` before every addon in the DOM. The input is the primary control and addons
are read or reached after it. Use `align="inline-start"` or `align="inline-end"` for visual
placement without changing semantic or focus order.

## Accessibility and interaction

Every `InputGroupInput` needs an accessible name from a visible label, `aria-label`, or
`aria-labelledby`, following the [Base UI Input] contract.

Wrap the group in `Field` when it needs a shared name, label, validation state, description, or
error. Field state propagates to `InputGroupInput`, and `InputGroup` derives the shared invalid,
disabled, and focus visuals from its direct input. Do not duplicate those states on addons or
recreate their styles on the group.

Treat plain addon text and icons as supporting content; decorative icons should be `aria-hidden`.
Put interactive content in a semantic `Button`, `IconButton`, or link instead of adding click or
keyboard behavior to the addon itself. Those controls keep their own focus and events.

Pressing the group's non-interactive surface focuses its direct input. Pressing an interactive
addon targets that control and does not move focus to the input. Portalled addon content is outside
the group's event path and does not refocus the input. A consumer can cancel the shared-surface
behavior by calling `preventDefault()` from `InputGroup`'s `onMouseDown`.

## Sizing

The current contract supports the default input size. Add a new size to `InputGroup` rather than
resizing the input and addons independently; the group owns the shared surface and addon layout.

## Related guides

- Read [Forms] for labels, validation, descriptions, and grouped controls.
- Read [Base UI Input] for the upstream native input contract.

[Base UI Input]: https://base-ui.com/react/components/input
[Forms]: ../../docs/forms.md
