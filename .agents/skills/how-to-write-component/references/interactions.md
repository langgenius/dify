# Component Interactions And Overlays

Read this document when a change involves application hotkeys, focus, dialogs, menus, popovers, or other secondary surfaces. Overlay primitive selection and layering are owned by the [overlay contract].

## Focus And Semantics

- Preserve a visible focus indicator on the final focusable element. Styled Dify UI controls usually provide it; headless anatomy parts and direct trigger exports may not.
- Native buttons, links, custom trigger renderers, clickable rows, icon controls, and menu-like items must retain their correct native semantics and accessible name.
- Do not hide an outline without an equivalent visible `focus-visible` treatment. Follow an existing Dify UI pattern rather than inventing a call-site style.

## Keyboard Commands

- Keep widget navigation, dialog dismissal, and editor commands in their local primitive or owner.
- For Web application commands, follow [Keyboard commands] for TanStack registration, typed bindings, targets, event consumption, display, and verification. Do not recreate that policy in a wrapper or a second command framework.

## Secondary Surfaces

- Follow the [overlay contract] for primitive choice and shared mechanics. The nearest consumer `AGENTS.md` owns application-specific composite reuse policy.
- Separate behavior ownership from placement ownership: the action may own trigger, open state, and menu content while the caller owns slots, offsets, and alignment.
- Keep menu and dialog surfaces as siblings when a menu command opens a dialog. Mount the dialog outside popup content.
- Use the [overlay contract] to determine content lifetime and preserve the Root's closing lifecycle. Follow [state ownership] for draft placement and semantic identity; portal placement alone does not locate the state owner.
- Place query subscriptions and mutation observers at the owner whose lifetime matches when they should run. Mounted-session work may belong inside content; work that must start or stop exactly with `open` needs an explicit open-state condition.
- Prefer primitive-owned open state unless another owner must observe or coordinate it. Analytics callbacks and local cleanup alone do not require a controlled root.

[overlay contract]: ../../../../packages/dify-ui/docs/overlays.md
[Keyboard commands]: ../../../../web/docs/hotkeys.md
[state ownership]: state.md
