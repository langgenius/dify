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
- Compose Root, Trigger, and content at the entry that owns the business behavior, so the whole anatomy is visible there. A shared layer exports content and state parts; it does not take a trigger prop or wrap the Root and hide the content it renders. The caller owns slots, offsets, and alignment.
- Keep menu and dialog surfaces as siblings when a menu command opens a dialog. Mount the dialog outside popup content.
- Use the [overlay contract] to determine content lifetime and preserve the Root's closing lifecycle. Follow [state ownership] for draft placement and semantic identity; portal placement alone does not locate the state owner.
- Place query subscriptions and mutation observers at the owner whose lifetime matches when they should run. Mounted-session work may belong inside content; work that must start or stop exactly with `open` needs an explicit open-state condition.
- A Suspense boundary inside popup content gives a query the content lifetime. Call the suspense query in a content component under that boundary; do not add a forwarding layer or gate the query input on `open`.
- The owner whose `onOpenChange` cancels dismissal during a pending request owns that mutation and passes its state and result down. Do not locate a mutation through context or by scanning the mutation cache.
- A surface that shows an async outcome renders from the mutation result; the only state it adds is the open flag. Do not copy the result into local state or clear it on close.
- When the element that opened a surface may be gone once the action succeeds, give `finalFocus` a stable target and decide it in the success callback, before the surface starts closing.
- Prefer primitive-owned open state unless another owner must observe or coordinate it. Analytics callbacks and local cleanup alone do not require a controlled root.

[overlay contract]: ../../../../packages/dify-ui/docs/overlays.md
[Keyboard commands]: ../../../../web/docs/hotkeys.md
[state ownership]: state.md
