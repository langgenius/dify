# Button

Use `Button` for an action with a visible text label. Use [`IconButton`] for an icon-only
command, `Toggle` for a persistent pressed state, and a native link when activation navigates to
a URL.

Dify UI `Button` is an opinionated wrapper around [Base UI Button]. It adds Dify variants,
sizes, content spacing, and a `loading` state while preserving the upstream button, focus, and
composition behavior.

## Button semantics

`Button` renders a native `<button type="button">` by default. Set `type="submit"` explicitly
when the button submits a form:

```tsx
<form onSubmit={handleSubmit}>
  <Button type="submit">Save</Button>
</form>
```

Do not render a link through `Button`. Base UI applies button semantics, keyboard interaction,
and disabled behavior to the rendered element. Keep navigation on a native anchor or routing
link and reuse only the visual variants:

```tsx
<a className={buttonVariants({ variant: 'secondary' })} href="/settings">
  Settings
</a>
```

Use `render` with `nativeButton={false}` only when a non-button element intentionally needs
button semantics. It is not a link mode.

## Loading and disabled states

`disabled` and `loading` describe different facts:

| Prop       | Meaning                                      | Default focus behavior                                |
| ---------- | -------------------------------------------- | ----------------------------------------------------- |
| `disabled` | The action is unavailable.                   | Native-disabled and removed from the tab order.       |
| `loading`  | The action was triggered and is now pending. | Activation is blocked while the button retains focus. |

`loading` owns Base UI's disabled interaction, retained focus, and the decorative spinner. The
button remains in the tab order with `aria-disabled`, and Dify UI suppresses activation. Pass the
pending state only to `loading`:

```tsx
<Button loading={isSaving}>Save</Button>
```

Keep independent availability conditions in `disabled`:

```tsx
<Button loading={isSaving} disabled={!canManageSettings}>
  Save
</Button>
```

Do not repeat the pending state in `disabled`:

```tsx
// Incorrect: loading already handles isSaving.
<Button loading={isSaving} disabled={isSaving || !canManageSettings}>
  Save
</Button>

// Correct.
<Button loading={isSaving} disabled={!canManageSettings}>
  Save
</Button>
```

Pass `focusableWhenDisabled={false}` only when a loading button should opt into native disabled
behavior and may leave the tab order.

### Accessible loading feedback

The spinner is decorative. Keep a non-empty visible label throughout loading. If the visible label
stays the same, its text continues to name the button:

```tsx
<Button loading={isSaving}>Save</Button>
```

When the label changes while the focused button enters loading, give the changing text a stable ID
and reference it explicitly. Some browser and screen-reader combinations do not reliably announce
changes to a focused button's descendant text:

```tsx
const labelId = useId()

<Button loading={isSaving} aria-labelledby={labelId}>
  <span id={labelId}>{isSaving ? 'Saving' : 'Save'}</span>
</Button>
```

The consumer owns this relationship because only it knows whether the label changes and whether
other visible context must also be referenced. Do not replace the changing text with `aria-label`.

`Button` does not add `aria-busy`: [WAI-ARIA `aria-busy`] describes an element whose own updates may
be deferred by assistive technology, not a generic pending action. Long-running announcements and
progress remain with the feature's status, live-region, or progress owner.

## Content and spacing

`Button` owns spacing between its direct children. Do not add icon margins or a standard `gap-*`
at call sites:

```tsx
<Button>
  <span aria-hidden="true" className="i-ri-rocket-line size-4" />
  Launch
</Button>
```

Regular (`medium`) and `large` sizes use 4px and 6px gaps. `small` uses 3px for `primary` and 4px
for the other variants. Use a `className` override only for a documented layout exception.

## Related guides

- Read [`IconButton`] for icon-only actions.
- Read [Accessible names and descriptions] when choosing or changing a naming source.
- Read [Base UI Button] for the upstream interaction and composition contract.

[Accessible names and descriptions]: ../../docs/accessible-names-and-descriptions.md
[Base UI Button]: https://base-ui.com/react/components/button
[WAI-ARIA `aria-busy`]: https://www.w3.org/TR/wai-aria#aria-busy
[`IconButton`]: ../icon-button/README.md
