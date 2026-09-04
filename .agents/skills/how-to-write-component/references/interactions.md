# Component Interactions And Overlays

Read this document when a change involves application hotkeys, focus, dialogs, menus, popovers, or other secondary surfaces. Overlay primitive selection and layering are owned by the [overlay contract].

## Focus And Semantics

- Preserve a visible focus indicator on the final focusable element. Styled Dify UI controls usually provide it; headless anatomy parts and direct trigger exports may not.
- Native buttons, links, custom trigger renderers, clickable rows, icon controls, and menu-like items must retain their correct native semantics and accessible name.
- Do not hide an outline without an equivalent visible `focus-visible` treatment. Follow an existing Dify UI pattern rather than inventing a call-site style.

## Keyboard Commands

- Distinguish application commands from widget-local keyboard semantics. Use `@tanstack/react-hotkeys` for application commands; keep menu navigation, dialog Escape handling, editor behavior, and ARIA widget keys in their local primitive or owner.
- Use `useHotkey` or `useHotkeys` for registered commands. When an existing `onKeyDown` intentionally owns the command, use `matchesKeyboardEvent` rather than duplicating modifier parsing or adding another global listener.
- Keep registration and keycap or menu display derived from one canonical command. Distinguish registered commands, held keys, and display-only accelerators.
- Keep a single-owner command beside its component. Create a feature-local hotkey module only when several production files share it; tests alone do not justify extraction.
- Make availability and scope explicit with `enabled`, `ignoreInputs`, and `target`. Put a target ref on the actual behavior owner rather than creating wrapper DOM solely for hotkey scope.
- Preserve existing `preventDefault` and propagation behavior when migrating command APIs.
- Test observable command behavior, disabled and input scope, target scope, and the registration/display contract at the owning feature boundary.

## Secondary Surfaces

- Follow the [overlay contract] for primitive choice and shared mechanics. The nearest consumer `AGENTS.md` owns application-specific composite reuse policy.
- Separate behavior ownership from placement ownership: the action may own trigger, open state, and menu content while the caller owns slots, offsets, and alignment.
- Keep menu and dialog surfaces as siblings when a menu command opens a dialog. Mount the dialog outside popup content.
- Keep overlay open-state ownership separate from content-session ownership. A controlled root does not require controlled fields or root-owned drafts.
- Match transient state to the primitive's content mount lifecycle. State below an unmounting content boundary gets a fresh instance after unmount; intentionally kept-mounted content needs an explicit persistence or reset policy.
- Keep a controlled overlay root at its coordination owner so the primitive can complete exit transitions, focus restoration, and detached-handle behavior. Do not conditionally remove the root to reset content state, and use keys only for stable semantic identity.
- Place query subscriptions and mutation observers at the owner whose lifetime matches when they should run. Mounted-session work may belong inside content; work that must start or stop exactly with `open` needs an explicit open-state condition.
- Prefer primitive-owned open state unless another owner must observe or coordinate it. Analytics callbacks and local cleanup alone do not require a controlled root.

[overlay contract]: ../../../../packages/dify-ui/docs/overlays.md
