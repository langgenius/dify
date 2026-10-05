# Keyboard Commands

Keep each command's binding, action, availability, and registration with the feature that owns
it. Use TanStack Hotkeys for application commands; keep text editing, widget navigation, and
primitive dismissal with their existing controls.

## Default pattern

Inside mounted content, bind directly to the actual command owner's ref:

```tsx
import type { Hotkey } from '@tanstack/react-hotkeys'
import { useHotkey } from '@tanstack/react-hotkeys'
import { useRef } from 'react'

const PUBLISH_HOTKEY = 'Mod+Shift+P' satisfies Hotkey

const popupRef = useRef<HTMLDivElement>(null)
useHotkey(PUBLISH_HOTKEY, publish, {
  target: popupRef,
  enabled: canPublish,
  ignoreInputs: true,
  requireReset: true,
})
```

Attach `popupRef` to the actual Popup. Call the same action as the button, with the same
availability. The library matches modifiers, consumes accepted events before the callback,
and keeps that callback current.

- **Scope:** pass the owner's ref. Omit `target` for intentional page/application commands.
  `ignoreInputs` only controls input filtering; form commands usually allow input targets.
- **Availability:** align `enabled` with permissions, loading, validation, and open state.
  Keep validation in the action too, since buttons and menus also invoke it.
- **Repeat:** use `requireReset: true` for one-shot commands; allow repeats for continuous zoom.

## Choose the registration boundary

| Situation                                            | Pattern                                                                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| The hook and target mount together                   | `useHotkey` with the actual owner ref. The ref may be local or passed from a parent.                               |
| Form content mounts later than its transaction owner | The actual Form's `onKeyDown + matchesKeyboardEvent` is a direct option; a hook inside mounted content also works. |
| Child React handlers must process the key first      | Handle it during React bubbling, or at document bubble with an owner-ref containment check, as Workflow does.      |

Choose by lifetime and event order. Being inside a Popup alone does not determine the API.
The target must exist when the hook's registration effect runs; changing `ref.current` does
not re-render the hook owner. Keep normal targets in `useRef` and transactions with their
business owner. Element state is useful when an external subscription reports target
replacement, such as Lexical's root listener; guard a nullable element with `enabled`, since
a bare null target falls back to document.

For a real form, call `event.currentTarget.requestSubmit()` to share submission and validation.
React Portal events follow React ancestry: a local handler should check DOM containment when
nested portals must stay outside its command. A feature may intentionally include its own
portalled menus, as the Skills file tree does.

## Bindings and hints

| Need                            | API and type                                                          |
| ------------------------------- | --------------------------------------------------------------------- |
| One command / a command group   | `useHotkey` / `useHotkeys`; retain feature command IDs.               |
| Binding definition              | `satisfies Hotkey` for strings; `satisfies RawHotkey` for objects.    |
| Existing React keyboard handler | `matchesKeyboardEvent(event.nativeEvent, binding)`.                   |
| Keycap hint                     | `formatForDisplay(binding, { parts: true })` with `Kbd` / `KbdGroup`. |
| A held modifier                 | `useKeyHold`; combine key state with the interaction's actual scope.  |

Share bindings between registration and hints; keep single-owner constants local. Use
`RegisterableHotkey` where both binding forms are accepted. `DisplayHotkey` is wider and belongs
only to display. Validate dynamic bindings before parsing; narrow the `key`/`code` union when
inspecting objects. Logical `Mod+S` follows the character; `Mod+[KeyS]` follows physical position.

Preserve the initial platform through SSR hydration, as navigation search does.
`aria-keyshortcuts` uses `Meta+K` or `Control+K`, not keycap glyphs or `Mod`.

## Conditional event handling

Use library defaults unless ownership or event priority requires a decision before consumption.
An element's native listener can precede child React handlers, and the manager does not skip
`defaultPrevented`. For these conditional owners, set `preventDefault: false` and
`stopPropagation: false`, check scope and `defaultPrevented`, then consume the accepted event.
For one-shot actions in this mode, consume repeats before returning on `event.repeat`; leave
`requireReset` unset so its latch cannot bypass that consumption.

The library filters composing printable shortcuts such as `Mod+S`. Custom submission and
logical Enter/Escape still need IME protection; retain existing composition-end handling.
`stopPropagation()` stops ancestors, not another callback on the same manager target.
Keep eligible owners unambiguous; `conflictBehavior: 'replace'` is not a restoring modal stack,
and provider defaults or metadata do not establish scope.

Let Dialog, Popover, and Menu primitives own dismissal. A container handling bubbled child
events keeps its actual semantics; an explained lint exception is preferable to inventing a
button role or tab stop. Custom nonmodal panels should describe their real modality.

## Workflow ownership

| Layer                       | Responsibility                                                                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Canvas                      | `WorkflowCanvas` supplies the ReactFlow root ref. `useWorkflowHotkeys` runs after child React handlers and accepts events within that subtree. |
| Graph actions               | Existing graph hooks own permissions, mutations, history, and persistence; keyboard commands invoke them.                                      |
| Editors and node navigation | ReactFlow, local node handlers, Lexical, CodeMirror, and forms own navigation, undo, suggestions, and submission.                              |
| Portalled menus             | Each menu matches its displayed commands and acts on its actual node, edge, or selection.                                                      |
| Run and history             | Header features own page commands with button-aligned availability; header focus is unnecessary.                                               |
| Comments                    | The focused draft/thread handles dismissal after suggestions. Active pointer-following placement owns Escape without taking focus.             |

The outer Workflow container includes unrelated panels. Use the canvas root for graph scope,
restore canvas focus when deleting its focused object or applying graph undo/redo, and use
Popup `finalFocus` when a menu action deletes its return target. Keep text undo with editors.
Hold-to-dim combines key state with canvas focus and clears on focus loss.

## Verification and maintenance

Follow [the Web testing policy]. Use the real matcher/manager to verify scope, availability,
mount/reopen behavior, child event priority, IME flags, and repeat where affected. Verify
native editing, focus, and selection in a browser; check both platform modifiers for binding
or hint changes. State the limits of simulated IME and SDK mocks.

Follow these patterns for new commands. Recorders, remapping, and extra wrappers need a
concrete product requirement.

## References

- [TanStack Hotkeys options]
- [TanStack formatting]
- [React Portal events]
- [Delegated event handlers]
- [Modal dialog requirements]
- [Character shortcuts and focus]

[Character shortcuts and focus]: https://www.w3.org/WAI/WCAG22/Understanding/character-key-shortcuts.html
[Delegated event handlers]: https://github.com/jsx-eslint/eslint-plugin-jsx-a11y/blob/main/docs/rules/no-static-element-interactions.md
[Modal dialog requirements]: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal
[React Portal events]: https://react.dev/reference/react-dom/createPortal
[TanStack Hotkeys options]: https://tanstack.com/hotkeys/latest/docs/framework/react/guides/hotkeys
[TanStack formatting]: https://tanstack.com/hotkeys/latest/docs/framework/react/guides/formatting-display
[the Web testing policy]: test.md
