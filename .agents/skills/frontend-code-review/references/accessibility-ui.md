# Accessibility And Interaction Review

Broken keyboard access, missing accessible names, focus loss, and unreachable content are
correctness defects. Review the rendered behavior and the feature's workflow, including the
primitive defaults and composed props. Missing attributes, handlers, or classes at a call site
do not establish a defect when their owner already supplies them.

## Semantics And Names

- Does the final element preserve the intended action, navigation, or field semantics and its
  keyboard behavior? Check the primitive's composition contract before judging its rendered tag.
- Do controls, meaningful images, and icon-only actions have usable text alternatives? Does
  decorative content interfere with the resulting name or accessibility tree?
- When labels, help, errors, or hidden text change, read [Accessible names and descriptions].
  Check computed names and descriptions in the affected states, including content that unmounts.
  A matching `aria-label` string alone does not establish a redundant override.
- For page structure changes, read [Page landmarks] and inspect the composed page with its parent
  layouts. Check heading relationships, landmark names, and affected semantic test locators.

## Keyboard, Focus, And Async Transitions

- Can users reach, operate, and leave the changed control or surface by keyboard? Follow
  [Keyboard commands] for application hotkeys; widget key behavior belongs to its primitive.
- Is the actual focus target visibly indicated? Read [Styling] for indicator ownership, including
  text controls and wrappers around native inputs. Fix the owning component instead of adding
  duplicate indicators at call sites.
- Does focus remain useful through pending, success, failure, dismissal, and retry? Check the
  focused control, the next keyboard action, and any focus-return target when availability changes.
  Follow the [Button contract] for loading and disabled buttons; other controls need their own
  interaction contract, not an automatic native-disabled or `aria-disabled` substitution.
- Are unavailable actions blocked through supported pointer and keyboard paths? Check existing
  primitive handling before requesting additional event guards.
- Can users understand why they cannot proceed and perceive the status needed to continue?
  Keep names available during loading and check the feature-owned feedback path. For Web toasts,
  follow [Toasts] rather than requiring a toast or live region for every state change.

## Forms

Read [Forms] when submission, field composition, validation, or reset behavior changes.

- Does the intended form own submission, including keyboard submission? Check final button types
  and primitive defaults instead of requiring redundant `type` props at every call site.
- Do the intended values participate in submission and validation, with the right name and
  disabled/read-only behavior? Follow the selected control's contract for labels and value types.
- Can users enter the required data with supported input methods, paste, and relevant autofill?
  Verify input attributes against the field's purpose rather than applying one input template.
- Are errors associated with their fields, exposed at the right time, and recoverable? Verify
  invalid-field focus and reset through the actual form/control integration.

## Overlays And Content Reachability

Read [Overlays] for semantic selection, portals, presence, layering, and dismissal. Use the
[Infotip contract] when an information icon opens an explanation; text length alone does not
choose between Tooltip, Infotip, and Popover.

- Can pointer, keyboard, touch, and assistive-technology users reach content needed for the flow?
  A supplementary hover preview must not be the only route to essential information.
- Does the trigger keep its name while closed, and does the open popup have the required name?
  Check the selected primitive's contract before adding titles or descriptions.
- Do open/close transitions preserve the intended focus, dismissal, and draft lifetime? Trace the
  root and content lifetimes separately; portal placement alone does not reset ancestor state.

## Visual And Runtime Evidence

For changed layouts, check whether long or localized content, supported viewport sizes, zoom,
or forced colors obscure information, controls, or focus. For changed motion, check relevant
reduced-motion behavior and whether interaction remains usable. Report the demonstrated failure,
not the absence of a preferred CSS utility.

When source evidence cannot settle native focus transitions, keyboard behavior, layout, or popup
presence, verify in the browser. Mocked DOM results and type checks alone do not establish those
behaviors. Consult current official Base UI documentation, installed declarations, or browser
and accessibility standards when the relevant local contract does not settle the question.

[Accessible names and descriptions]: ../../../../packages/dify-ui/docs/accessible-names-and-descriptions.md
[Button contract]: ../../../../packages/dify-ui/src/button/README.md
[Forms]: ../../../../packages/dify-ui/docs/forms.md
[Infotip contract]: ../../../../packages/dify-ui/src/infotip/README.md
[Keyboard commands]: ../../../../web/docs/hotkeys.md
[Overlays]: ../../../../packages/dify-ui/docs/overlays.md
[Page landmarks]: ../../../../web/docs/landmarks.md
[Styling]: ../../../../packages/dify-ui/docs/styling.md
[Toasts]: ../../../../web/docs/toasts.md
