# Component Interactions And Overlays

Read this document when a change involves application hotkeys, focus, dialogs, menus, popovers, or other secondary surfaces. Overlay primitive selection and layering are owned by the [overlay contract].

## Focus And Semantics

- Preserve a visible focus indicator on the final focusable element. Styled Dify UI controls usually provide it; headless anatomy parts and direct trigger exports may not.
- Native buttons, links, custom trigger renderers, clickable rows, icon controls, and menu-like items must retain their correct native semantics and accessible name.
- Do not hide an outline without an equivalent visible `focus-visible` treatment. Follow an existing Dify UI pattern rather than inventing a call-site style.

## Keyboard Commands

- Keep widget navigation, dialog dismissal, and editor commands in their local primitive or owner.
- For Web application commands, follow [Keyboard commands]. Keep registration and business behavior with the feature owner; do not introduce a second command framework.

## Secondary Surfaces

- Follow the [overlay contract] for primitive choice and shared mechanics. The nearest consumer `AGENTS.md` owns application-specific composite reuse policy.
- A controlled composite may emit several callbacks synchronously for one gesture, such as changing a mode and then initializing its selection. Every callback sees the same render snapshot. Compose changes through one owner command or functional state update; when later callbacks or immediate side effects require the latest draft before React rerenders, maintain an interaction-owned ref updated in the handlers and clear it at the same semantic reset boundary as the draft.
- Compose Root, Trigger, and content at the entry that owns the business behavior, so the whole anatomy is visible there. A shared layer exports content and state parts; it does not take a trigger prop or wrap the Root and hide the content it renders. The caller owns slots, offsets, and alignment.
- Keep menu and dialog surfaces as siblings when a menu command opens a dialog. Mount the dialog outside popup content.
- Treat an action surface as a state boundary when its input feeds several sibling menus, dialogs, default values, confirmation messages, or mutation parameters. Inject the smallest stable identity or snapshot once; keep the form draft local unless other owners must react to it.
- Use the [overlay contract] to determine content lifetime and preserve the Root's closing lifecycle. Follow [state ownership] for draft placement and semantic identity; portal placement alone does not locate the state owner.
- Place query subscriptions and mutation observers at the owner whose lifetime matches when they should run. Mounted-session work may belong inside content; work that must start or stop exactly with `open` needs an explicit open-state condition.
- Data inside a surface follows its owner's mount, not the `open` flag. A query declared in popup content under a Suspense boundary takes the content lifetime; a result the surface displays stays with its owner until that owner unmounts.
- Anything read while a surface closes, such as the return-focus target, must come from an owner that outlives the close. The element that opened the surface may unmount with its data, and a per-call mutation callback is dropped when its component unmounts.
- Prefer primitive-owned open state unless another owner must observe or coordinate it. Analytics callbacks and local cleanup alone do not require a controlled root.
- Do not merge dialogs with different loading guards, reset policies, or lifetimes into one discriminated `currentDialog` state merely to reduce atom count.

[overlay contract]: ../../../../packages/dify-ui/docs/overlays.md
[Keyboard commands]: ../../../../web/docs/hotkeys.md
[state ownership]: state.md
