# Keyboard Commands

Use TanStack Hotkeys for application commands. Keep registration, business actions, and
availability with the feature owner; keep text editing, widget navigation, and dismissal with
their existing editor or Dify UI primitive. Do not add a generic shortcut wrapper.

The official [React guide] owns library options and [defaults], including input filtering,
keyboard layouts, composition matching, and repeats. This document adds Dify's integration
contracts. Check the installed declarations when an API differs from the latest documentation.

## Registration and availability

For commands belonging to mounted popup content, pass the actual owner's ref:

```tsx
const PUBLISH_HOTKEY = 'Mod+Shift+P' satisfies HotkeyChord
const popupRef = useRef<HTMLDivElement>(null)

useHotkey(PUBLISH_HOTKEY, publish, {
  target: popupRef,
  enabled: canPublish,
  requireReset: true,
})
```

Attach the ref to the Popup. Import the hook and type from `@tanstack/react-hotkeys` and
`useRef` from React. Call the button's action, including its validation and permission checks.

- Use `enabled` when an unavailable command should release the key entirely. A disabled
  registration does not consume the event. If the browser action must remain suppressed,
  keep the registration enabled and guard the business action inside its callback instead.
- Use default input filtering unless the feature requires otherwise. Form submission may need
  `ignoreInputs: false`; canvas commands use `true` to preserve editing. See [defaults].
- Use `requireReset: true` for one-shot commands with default consumption; allow continuous
  actions such as zoom to repeat. Conditional event owners follow the rules below.
- Pass a ref, not `ref.current`. An empty ref skips registration; a bare null target falls back
  to document. Ref mutation does not re-render the owner: put the hook in mounted content or
  use the actual Form's `onKeyDown` when it mounts later. Lexical root replacement can use its
  root subscription with element state; disable registration while that element is null.
- For form commands, call `event.currentTarget.requestSubmit()` to share native submission and
  validation. React events from nested portals follow React ancestry; check DOM containment
  when those portals must be excluded. The Skills file tree intentionally includes its menus.

## Bindings and display

| Boundary                     | Contract                                                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| One command / a group        | `useHotkey` / `useHotkeys`; preserve feature command IDs.                                                         |
| Chord-only strings / objects | `HotkeyChord` / `RawHotkeyChord`; use `satisfies` for constants.                                                  |
| Both chord forms             | `RegisterableHotkeyChord`; `Hotkey` / `RegisterableHotkey` also admit sequences.                                  |
| Existing React handler       | `matchesKeyboardEvent(event.nativeEvent, chord)` matches one chord only.                                          |
| Keycaps                      | Share the binding with registration; use `formatForDisplay(..., { parts: true })` and Dify UI `Kbd` / `KbdGroup`. |

Use `DisplayHotkeyChord` for chord-only display boundaries. Sequence formatting returns groups
of keycaps; do not widen a chord renderer without implementing that UI. Follow [formatting] for
logical/physical keys, validation, and labels. Preserve the initial platform through hydration,
as navigation search does. `aria-keyshortcuts` uses `Meta+K` or `Control+K`, not glyphs or `Mod`.

Local constants are the default. Use native [app hotkeys] when a product needs app-wide discovery
or remapping: declarations contain no callbacks; business callbacks stay with their feature.
Recording, sequences, and modifier hints are optional capabilities, not migration requirements.

## Event ownership and scopes

A DOM target limits event origin; a [scope] controls whether TanStack registrations are active.
Neither replaces editor handling or Dify UI dismissal. Use a scoped provider above its hook
consumers, with a unique name for independently mounted surfaces. Same-scope matches may all
run; `conflictBehavior: 'replace'` is not a restoring stack, and metadata is not activation.

Use `exclusive` when a modal feature must suspend background application commands. Activate it
with the interactive content, not a permanently mounted Root. Content may retain exclusivity
through its closing transition; hidden retained content needs explicit `enabled` handling.
Preserve commands needed inside the modal: GotoAnything consumes repeated `Mod+K` inside its
scope while the global opener is suspended. Scope precedence and exceptions belong to [scope].

Use normal library consumption unless the owner must decide whether to claim an event:

- An element's native listener can precede child React handlers. When children must go first,
  handle React bubbling, or use document bubble plus owner containment as Workflow does.
  `capture: true` is for an intentional requirement to precede descendants, not a general fix.
- The manager does not skip `defaultPrevented`. Conditional owners set `preventDefault: false`
  and `stopPropagation: false`, check scope and `defaultPrevented`, then consume accepted events.
  Consume repeats before returning on `event.repeat`; leave `requireReset` unset in this mode
  so its callback latch cannot bypass that consumption. `stopPropagation()` does not stop
  another callback on the same manager target.
- Keep IME protection for custom submission and logical Enter/Escape, including existing
  composition-end handling. Library composition filtering does not cover those named keys.
- A container delegating child events retains its real semantics. Explain a necessary lint
  exception instead of adding a fake button role or tab stop.

[Character shortcuts], including Shift plus a character, must be disableable, remappable to
include a non-character key, or limited to focus within their owning component. Input filtering
or an active page-wide scope alone is insufficient.

## Workflow boundaries

| Owner             | Responsibility                                                                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canvas            | `WorkflowCanvas` supplies the ReactFlow root ref. `useWorkflowHotkeys` runs after child React handlers and accepts only events within that subtree. |
| Graph actions     | Existing graph hooks own permissions, mutations, history, and persistence. Keyboard commands invoke them.                                           |
| Editors and nodes | ReactFlow, local handlers, Lexical, CodeMirror, and forms own navigation, undo, suggestions, and submission.                                        |
| Portalled menus   | Match displayed commands and act on the actual node, edge, or selection.                                                                            |
| Run and history   | Header features own page commands; header focus is unnecessary.                                                                                     |
| Comments          | Focused draft/thread dismissal runs after suggestions. Active pointer-following placement owns Escape without taking focus.                         |

The outer Workflow container includes unrelated panels; use the canvas root for graph scope.
Restore canvas focus after deleting its focused object or applying graph undo/redo. Use Popup
`finalFocus` when a menu action deletes its return target. Hold-to-dim combines held-key state
with canvas focus and clears on focus loss; held-key state alone does not establish ownership.

## Verification

Follow [Web testing]. Use the real matcher/manager to verify affected scope, availability,
mount/reopen behavior, child priority, IME flags, and repeats. Check native editing, focus, and
selection in a browser, and both platform modifiers for binding or hint changes. State the
limits of simulated IME and mocked business actions.

[Character shortcuts]: https://www.w3.org/WAI/WCAG22/Understanding/character-key-shortcuts.html
[React guide]: https://tanstack.com/hotkeys/latest/docs/framework/react/guides/hotkeys
[Web testing]: test.md
[app hotkeys]: https://tanstack.com/hotkeys/latest/docs/framework/react/guides/app-hotkeys
[defaults]: https://tanstack.com/hotkeys/latest/docs/guides/sensible-defaults
[formatting]: https://tanstack.com/hotkeys/latest/docs/framework/react/guides/formatting-display
[scope]: https://tanstack.com/hotkeys/latest/docs/framework/react/guides/hotkeys-provider-and-scopes
