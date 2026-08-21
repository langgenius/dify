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

Internally, Dify UI maps these states to Base UI's interaction contract:

```tsx
disabled={disabled || loading}
focusableWhenDisabled={focusableWhenDisabled ?? loading}
```

Base UI recommends disabling a loading button while setting `focusableWhenDisabled` so that an
action does not lose focus after it is triggered. Dify UI's `loading` prop owns that wiring and
adds the visible spinner. The loading button remains in the tab order with `aria-disabled`
instead of the native [`disabled`] attribute. Unlike native disabled, [`aria-disabled`] preserves
focusability but requires the component to suppress activation. Callers should pass the pending
state only to `loading`:

```tsx
<Button loading={isSaving}>Save</Button>
```

Keep independent availability conditions in `disabled`:

```tsx
<Button loading={isSaving} disabled={!canSave}>
  Save
</Button>
```

Do not repeat the same pending state in `disabled`:

```tsx
// Incorrect: loading already blocks activation.
<Button loading={isSaving} disabled={isSaving}>
  Save
</Button>

// Incorrect: keep only the independent availability condition in disabled.
<Button loading={isSaving} disabled={isSaving || !canSave}>
  Save
</Button>

// Correct.
<Button loading={isSaving} disabled={!canSave}>
  Save
</Button>
```

It is valid for `loading` and an independent `disabled` condition to both evaluate to `true`.
The loading focus policy applies while the action is pending; when loading ends, the remaining
availability condition still determines whether the button is disabled.

Pass `focusableWhenDisabled={false}` only when a loading button should opt into native disabled
behavior and may leave the tab order.

### Accessible loading feedback

The loading spinner is decorative and does not replace the button's visible label. `Button` does
not add `aria-busy`: [WAI-ARIA `aria-busy`] defines it for an element being modified whose
content changes may be deferred by assistive technology, not as a generic substitute for a
pending action state. When a long-running operation needs an announcement or progress updates,
the feature owns the corresponding status, live region, or progress component.

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
- Read [Base UI Button] for the upstream interaction and composition contract.

[Base UI Button]: https://base-ui.com/react/components/button
[WAI-ARIA `aria-busy`]: https://www.w3.org/TR/wai-aria#aria-busy
[`IconButton`]: ../icon-button/README.md
[`aria-disabled`]: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-disabled
[`disabled`]: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/disabled
