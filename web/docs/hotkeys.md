# Keyboard Commands

Use TanStack Hotkeys for application commands. Keep the binding, action, availability, and
registration beside the feature that owns them. Keep editor behavior and widget navigation in
their existing owner: Lexical commands, Base UI dismissal/navigation, or a local `onKeyDown`.

## Choose the owner

| Behavior                                                                      | Registration                                                                                                       |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Global search or detail-sidebar toggle                                        | Document-level `useHotkey` in the application shell.                                                               |
| Run or publish the current page                                               | Document-level `useHotkey` in the mounted page feature, sharing the button's availability.                         |
| Submit a dialog, edit card, or publisher popup                                | `useHotkey` with the actual form or popup's ref as `target`.                                                       |
| Workflow copy, delete, save, or canvas modes                                  | `useHotkeys` on document, accepting only events within the focused ReactFlow root ref after nested React handlers. |
| File-tree clipboard commands                                                  | The file tree and its own portalled menus; native clipboard handling stays with the tree.                          |
| Menu navigation, primitive dismissal, text editing, resize, or tree traversal | The widget, editor, or primitive's local keyboard handling.                                                        |
| A modifier held during an interaction                                         | `useKeyHold`; key state is not command ownership.                                                                  |
| A keycap hint                                                                 | `formatForDisplay` and Dify UI `Kbd`; displaying a hint does not register a command.                               |

Put refs on existing behavior owners; do not add wrapper DOM just for keyboard scope. Pass the
ref itself to `target`, not `ref.current` read during render. Focused descendants' events bubble
to their owner, so the owner does not need an extra tab stop just to listen. A canvas that itself
receives focus does need a focusable root and visible focus indicator.

A ref becoming non-null does not cause a React render. If a Portal mounts its content after the
registering component's effect, move registration and the interaction state into the mounted
content owner. When a parent genuinely owns a transaction with an independently mounted form,
use a state callback ref and pass the resulting element as `target`, with `enabled` requiring
that element. Do not add a parent effect or a listener-only component to patch a misplaced owner.

Portals follow the real DOM event path. A React-owned popup is not automatically inside its
parent’s native `target`. Bind to the actual popup or handle its keys through its owning React
widget. Do not infer ownership by finding any matching role elsewhere in the document.

## Workflow layers

Workflow has several keyboard owners; mounting them on the same page does not merge their scope.

| Layer                        | Owner and enforcement                                                                                                                                                                                                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canvas interaction           | `WorkflowCanvas` attaches the real ReactFlow root ref and manages focus when selecting the pane, nodes, or a group. `useWorkflowHotkeys` accepts events inside that DOM subtree after child React handlers, then calls existing action hooks.                                 |
| Graph mutations              | `useNodesInteractions`, `useEdgesInteractions`, `useWorkflowOrganize`, and `useNodesSyncDraft` own permissions, collaborative mutations, history, and persistence. Keyboard registration does not implement a second mutation path. `Mod+S` requests the existing draft sync. |
| Node navigation and movement | ReactFlow node focus and `useNodeKeyboardInteractions` own arrow/selection behavior. These local controls remain separate from canvas command bindings.                                                                                                                       |
| Graph action menus           | The actual portalled node, selection, edge, pane, note, or zoom menu matches its displayed commands locally and calls the same available actions as its items. It does not depend on canvas DOM containment.                                                                  |
| Text editors and node forms  | Lexical, CodeMirror, inputs, and local forms own text editing, undo, suggestions, and submission. Canvas `ignoreInputs` is one filter; containment and consumed-event checks enforce the wider boundary.                                                                      |
| Run and version history      | Mounted header features own page commands. They do not require header focus, and retain their explicit input and availability policy. The opened run menu owns its numeric choices.                                                                                           |
| Comments and popups          | The focused comment or actual popup owns dismissal and submission. Mention suggestions get Escape before the comment. Portalled forms do not inherit canvas ownership.                                                                                                        |

Do not use the outer Workflow container as a shortcut target: it also contains panels and
overlays. Returning focus to the canvas is an explicit transition. Before keyboard deletion or
graph undo/redo can remove a focused node, return focus to the canvas so the next command still
has an owner. Text undo stays in Lexical through the event boundary; do not mirror editor focus
into a Workflow history-enabled store flag. Hold-to-dim uses key state plus canvas focus and
clears on focus loss. Escape during comment placement belongs to that active placement state,
because the pointer-following preview intentionally does not take focus.

## Availability and event handling

- `enabled`: use the same permissions, loading, validation, and lifecycle conditions as the
  visible action. Keep action-level validation too, because buttons and menus also call it.
- `ignoreInputs`: choose an editing policy explicitly. Canvas commands and sidebar `Mod+B`
  leave editing fields alone; form submission uses `false` so it works while typing.
- Repeat: distinguish repeating a command from consuming a repeated event. For a command that
  claims events manually, keep `requireReset: false`, consume each accepted event, then skip its
  action when `event.repeat` is true. Otherwise TanStack's reset latch skips the callback and the
  repeated event can reach a browser default such as Save. `requireReset: true` suits owners
  using the manager's automatic consumption. Allow repeat for zooming or moving a selection.
- IME: guard custom submission with the native `isComposing` event. Preserve existing
  composition-end protection; library matching does not guarantee safe logical Enter/Escape.

Mounting is not the same as opening a popup. Prefer declaring its hook in the actual content
owner. If that owner stays mounted when closed, include the open state in `enabled`.

TanStack defaults to `preventDefault: true` and `stopPropagation: true`, applied **before** the
callback. Use those defaults when the scoped registration unconditionally owns the event.
For a conditional command, disable automatic consumption, check the event, then consume it
only after accepting the command. Inside a form owner:

```tsx
const SAVE_HOTKEY = 'Mod+S' satisfies Hotkey
const formRef = useRef<HTMLFormElement>(null)

useHotkey(
  SAVE_HOTKEY,
  (event) => {
    if (event.defaultPrevented || event.isComposing) return

    event.preventDefault()
    event.stopPropagation()
    if (event.repeat) return
    formRef.current?.requestSubmit()
  },
  {
    target: formRef,
    enabled: canSave,
    ignoreInputs: false,
    requireReset: false,
    preventDefault: false,
    stopPropagation: false,
  },
)
```

Attach `formRef` to the real form. Its `onSubmit` owns validation and saving, and the visible
button submits the same form. Import `Hotkey` and `useHotkey` from `@tanstack/react-hotkeys`,
and `useRef` from React. The hook keeps its callback current; it does not require `useCallback`.

A native listener on a form or canvas can run before a child's React `onKeyDown`, because React
delegates handlers to its root. `target` alone does not give child React handlers priority. When
that priority is required, keep local handling in React or register on document and explicitly
check the real owner ref before claiming the event, as Workflow does. A ref determines command
ownership even when the listener must be on an ancestor. Test this with an actual child React
handler; a native listener fixture does not prove the same ordering.

`defaultPrevented` is a cooperation signal, not automatic priority. `preventDefault()` cancels
browser defaults without stopping other handlers. `stopPropagation()` stops ancestor propagation, not the
manager's other callbacks on the same target. Avoid simultaneously eligible owners for the
same command on one target. Do not install a separate global browser-default guard for commands
that can be disabled or owned by an editor.

`conflictBehavior: 'warn'` allows duplicate registrations; `replace` is not a restoring modal
stack. Metadata such as `group` or a custom `scope` does not affect dispatch. `HotkeysProvider`
supplies default options, not separate managers or command scopes.

## Define once, register and display

Use `satisfies Hotkey` for static strings and `satisfies RawHotkey` for structured bindings.
Use `RegisterableHotkey` only where both are supported. Keep single-owner constants local;
extract a feature hotkey module when multiple production consumers share commands.

```tsx
const PUBLISH_HOTKEY = 'Mod+Shift+P' satisfies Hotkey
const keycaps = formatForDisplay(PUBLISH_HOTKEY, { parts: true })
// macOS: ['⌘', '⇧', 'P']; Windows/Linux: ['Ctrl', 'Shift', 'P']
```

Render each part with `Kbd` inside `KbdGroup`. Do not split bindings or display strings on `+`
or spaces; use the formatter for literal plus keys, physical codes, and objects. Do not hard-code
`⌘` for a `Mod` command. `DisplayHotkey` accepts wider input for formatting and must not widen
the command registry. Raw objects also allow dynamic strings; their types do not validate every
key name.

Use logical `Mod+S` for character-based commands. Use physical `Mod+[KeyS]` only for interactions
that deliberately follow keyboard position. Narrow `RawHotkey`/`ParsedHotkey`'s `key`/`code`
union before inspecting the identity. Persist portable bindings, not platform-resolved flags
or display labels.

Validate externally supplied bindings before normalizing them, and decide how to handle
warnings. Parsing may discard invalid modifiers; validation does not prove that the browser
or OS delivers the shortcut. Do not cast unvalidated strings to `Hotkey`.

For SSR hints, preserve an explicit initial platform through hydration, as the main navigation
search button does. `aria-keyshortcuts` needs names such as `Meta+K` or `Control+K`, not glyphs
or the library's `Mod` alias.

## Keep local semantics and verify the boundary

Use `matchesKeyboardEvent(event.nativeEvent, binding)` in an existing React `onKeyDown` when
that widget owns a combination. Do not recreate modifier parsing or add a global listener.
Chat/composer submission, Lexical history and formatting, slash menus, variable pickers,
inline edits, tree navigation, resize, and primitive dismissal remain local. The standalone
embed script and Node CLI readline input are also intentionally outside React hotkey hooks.

Follow [the Web testing policy]. Keep the real matcher/manager when testing scope,
disabled state, propagation, and repeat. Cover the changed owner: focus inside versus outside,
editable/consumed events, open versus closed, action availability, and release/repeat. Check
both primary platform modifiers when matching or display changes. Use browser evidence for
native selection, editor undo, or actual focus transitions that unit events cannot establish.

Devtools and `useHotkeyRegistrations` describe live registered commands, including disabled
ones. They cannot discover unmounted commands or external editor listeners. Sequences,
recorders, remapping, and modifier hints require their own product use case.

## References

- [TanStack Hotkeys options]
- [TanStack formatting]
- [DOM event propagation]
- [Character shortcuts and focus]

[Character shortcuts and focus]: https://www.w3.org/WAI/WCAG22/Understanding/character-key-shortcuts.html
[DOM event propagation]: https://developer.mozilla.org/en-US/docs/Web/API/Event/stopPropagation
[TanStack Hotkeys options]: https://tanstack.com/hotkeys/latest/docs/framework/react/guides/hotkeys
[TanStack formatting]: https://tanstack.com/hotkeys/latest/docs/framework/react/guides/formatting-display
[the Web testing policy]: test.md
