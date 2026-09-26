# Keyboard Commands

Use TanStack Hotkeys directly for application commands. Keep the binding, action, availability,
and registration with the feature that owns them. Keep text editing, widget navigation, and
primitive dismissal in their existing owner.

## Start with the library defaults

For a command owned by an actual popup, bind to that popup's ref and call the action directly:

```tsx
import type { Hotkey } from '@tanstack/react-hotkeys'
import { useHotkey } from '@tanstack/react-hotkeys'
import { useRef } from 'react'

const PUBLISH_HOTKEY = 'Mod+Shift+P' satisfies Hotkey

// Inside the mounted popup content:
const popupRef = useRef<HTMLDivElement>(null)
useHotkey(PUBLISH_HOTKEY, publish, {
  target: popupRef,
  enabled: canPublish,
  ignoreInputs: true,
  requireReset: true,
})
```

Attach `popupRef` to the real Popup. TanStack matches modifiers and consumes matching events
before calling `publish`. `requireReset: true` executes once until the key or modifier is
released. Leave it unset for continuous actions such as zoom. The hook keeps the callback
current; it does not need `useCallback` merely for registration.

- `target`: pass the owner's ref, not `ref.current` read during render. Omit it for an
  intentional page or application command, such as opening search or running the current page.
- `enabled`: share the visible action's permission, loading, validation, and open-state rules.
  Keep action-level validation because buttons and menus also invoke the action.
- `ignoreInputs`: choose whether this command belongs while editing. Canvas commands leave
  inputs alone; a form submission command allows them. This option is not a complete scope.

Do not add an event handler, DOM wrapper, element state, or effect when these options suffice.

## Register, match, and display

| Need                                  | API and type                                                                       |
| ------------------------------------- | ---------------------------------------------------------------------------------- |
| One application command               | `useHotkey`; a string checked with `satisfies Hotkey`.                             |
| A feature's collection of commands    | `useHotkeys`; preserve the feature's typed command IDs.                            |
| An existing local React handler       | `matchesKeyboardEvent(event.nativeEvent, binding)`.                                |
| A structured binding                  | `satisfies RawHotkey`; use `RegisterableHotkey` only when both forms are accepted. |
| Keycap hints                          | `formatForDisplay(binding, { parts: true })`, rendered with `Kbd` in `KbdGroup`.   |
| A modifier held during an interaction | `useKeyHold`; key state does not establish command ownership.                      |

Keep single-owner constants local. Share a feature binding when both registration and hints
consume it. Do not split strings on `+` or hard-code a macOS symbol for `Mod`. Logical `Mod+S`
follows the character; use physical `Mod+[KeyS]` only when keyboard position is intentional.
`DisplayHotkey` is wider than a registrable command and must not widen the command registry.
Narrow the `key`/`code` union before inspecting a structured binding; its types do not validate
every dynamic key name. Validate external bindings before parsing instead of casting to `Hotkey`.

For SSR hints, preserve an explicit initial platform through hydration, as the navigation
search button does. `aria-keyshortcuts` uses `Meta+K` or `Control+K`, not glyphs or `Mod`.

## Refs, portals, and local handlers

Register inside mounted popup content when its lifetime owns the command. A ref becoming
non-null does not cause a render. If a parent owns a transaction across independently mounted
surfaces, keep that state in the parent and use the actual form's React `onKeyDown` plus
`matchesKeyboardEvent`. Call `event.currentTarget.requestSubmit()` so keyboard and button
submission share validation. Do not add parent effects or DOM state just to bind the shortcut.
A state callback ref is useful only when a real subscription must track target replacement;
require the element in `enabled`, since a bare null target falls back to document.

Native listeners follow the DOM tree; React Portal events follow the React tree. Bind native
hotkeys to the actual popup. In a form's React handler, reject events outside
`event.currentTarget` so a nested Portal cannot submit its React ancestor. A feature may
intentionally delegate keys from its own portalled menus, as the Skills file tree does.

A container may handle bubbling keys from its children without becoming a focusable control.
Comment Escape handling, for example, runs after MentionInput has dismissed its suggestions.
Keep its actual semantics and a narrow, explained lint exception; do not add `role="button"`,
`role="presentation"`, or a tab stop merely to silence the rule. Let an existing Dialog,
Popover, or Menu primitive own dismissal. A custom nonmodal panel must not claim
`aria-modal="true"` while the surrounding page remains interactive.

## When manual event handling is necessary

TanStack's native listener on an element can run before a child's React `onKeyDown`. It also
does not skip an already prevented event. When a child must get first refusal, keep local
handling in React, or listen on document and check the actual owner ref afterward, as Workflow
does. A local `onKeyDown` is therefore sometimes the correct boundary, not redundant hotkey code.

For these conditional owners only, set `preventDefault: false` and `stopPropagation: false`,
check ownership and `defaultPrevented`, then consume the accepted event. If the action must not
repeat, consume each accepted event before returning on `event.repeat`. Leave `requireReset`
unset: its latch would skip the callback and therefore skip manual consumption of repeats.

The library already rejects composing printable shortcuts. Do not repeat that guard for
bindings such as `Mod+S` or `Alt+R`. Custom submission and logical Enter/Escape handling still
need their IME protection; preserve existing composition-end handling too. Ordinary image
previews have no text editor and can use the default event handling for their arrow commands.

`defaultPrevented` is a cooperation signal. `stopPropagation()` stops ancestors, not another
callback on the same manager target. Avoid simultaneously eligible owners of the same command.
`conflictBehavior: 'replace'` is not a restoring modal stack. Metadata and `HotkeysProvider`
defaults do not create scopes. Do not add a global browser-default guard for a disabled command.

## Workflow ownership

| Layer                     | Owner                                                                                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Canvas commands           | `WorkflowCanvas` supplies the real ReactFlow root ref. `useWorkflowHotkeys` listens after child React handlers and accepts events only inside that subtree.                    |
| Graph actions             | Existing node, edge, organize, and draft-sync hooks own permissions, mutations, history, and persistence; keyboard commands call the same actions.                             |
| Node movement and editors | ReactFlow, `useNodeKeyboardInteractions`, Lexical, CodeMirror, and local forms own their navigation, text undo, suggestions, and submission.                                   |
| Portalled graph menus     | Each actual menu matches its displayed commands and invokes its available actions; it does not inherit the canvas DOM target.                                                  |
| Run and history           | Mounted header features own page commands and share button availability; they do not require header focus.                                                                     |
| Comments                  | The focused draft or thread owns local dismissal after suggestions. Pointer-following placement owns Escape while placement is active because its preview does not take focus. |

The outer Workflow container also contains panels and overlays; it is not the canvas command
target. Focus the canvas before deleting a focused node or applying graph undo/redo. Menus
that delete their focus-return target use the Popup's `finalFocus` during dismissal. Keep text
undo in the editor through the event boundary, rather than mirroring editor focus into a
history-enabled store flag. Hold-to-dim combines key state with canvas focus and clears on
focus loss.

## Verify the changed boundary

Follow [the Web testing policy]. Keep the real matcher/manager for scope, disabled state,
propagation, and repeat tests. Exercise focus inside/outside, editable and consumed events,
open/closed state, action availability, and held-key release. Use a real child React handler
to verify ordering. Use browser evidence for native selection, editor undo, and focus changes
that unit events cannot establish. Check both platform modifiers when matching or hints change.

Devtools and `useHotkeyRegistrations` describe mounted registrations, not all product commands.
Sequences, recorders, remapping, and additional wrappers require a concrete product need.

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
