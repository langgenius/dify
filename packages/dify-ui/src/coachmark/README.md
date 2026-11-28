# Coachmark

`Coachmark` guides users through elements that already exist on the page. It is built on [Base UI Popover], which owns portal stacking, floating positioning, collision flipping/shifting, arrow placement, escape and close dismissal, transition states, and `role="dialog"` semantics.

Dify UI owns the guided-tour contract on top of Popover: target readiness, highlight union geometry, step snapshots across pending transitions, modal-layer coexistence, and target-preserving isolation.

## Anatomy and Part Responsibilities

- **`Coachmark`**: Controlled root. Owns step readiness (waiting for `target` and `highlightSelectors` to mount, become visible, leave `[data-starting-style]` and finite settling animations, and scroll into view), `payload` snapshotting across pending/closing states, `highlightSelectors` inertness, and `modal` isolation.
- **`CoachmarkPortal`**: Portals into `document.body` and steps aside (`detach`) whenever an upper modal marks the portal `aria-hidden="true"` or `inert`, returning once the target is reachable again.
- **`CoachmarkSpotlight`**: Visual dim overlay with a rounded cutout around `target` unioned with `highlightSelectors`. Subscribes directly to geometry updates and glides with `transform: translate3d(...)`.
- **`CoachmarkPositioner`**: Anchors the popup to the target/highlight union using logical sides only (`top`, `bottom`, `inline-start`, `inline-end`), keeps the popup visible and reachable even if the target scrolls out of a scroll container, and renders the pointer-blocking layer (with a dynamic target cutout in `modal="allow-target"`).
- **`CoachmarkPopup`**: Dialog surface owning step-change focus handoff, polite `aria-live` step-change announcements (portaled outside `CoachmarkPortal` so upper modals can still hide the portal cleanly), `data-pending` click interception (while keeping `CoachmarkClose` clickable), and the popup-to-target `Tab` loop in `modal="allow-target"`.
- **`CoachmarkArrow`**: Directional connector pointing from the popup edge toward the target.
- **`CoachmarkTitle`**: Persistent `<h2>` associated via `aria-labelledby` (keeps its ID stable across steps while fading inner content).
- **`CoachmarkStepLabel`**: Optional step-progress eyebrow rendered inside `CoachmarkTitle`.
- **`CoachmarkDescription`**: Scrollable body text associated via `aria-describedby`.
- **`CoachmarkActions`**: Footer action row.
- **`CoachmarkClose`**: Dismiss button wired to Base UI `Popover.Close`; stays clickable while `pending`.

## Ownership and Contracts

### Controlled state and `payload`

The caller owns step state and passes `open`, `target` (`Element | string | null`), and optionally `payload`:

- Pass `payload` with a render-function child (`({ payload }) => ...`) whenever step transitions may wait on a mounting or animating target. `Coachmark` freezes the previous step's payload while `data-pending` / `aria-busy` is active and while the close transition runs.
- `payload` accepts `Payload | undefined` and infers `Payload` as the non-`undefined` type. When `open={false}` (or while the next step's data is not ready), pass `payload={undefined}` instead of fabricating a dummy fallback or conditionally unmounting `<Coachmark>`.
- `onOpenChange` reports only `'close-press'` and `'escape-key'`; outside clicks never dismiss a coachmark.
- `onStepShown` runs each time a step becomes shown (including when recovering after stepping aside for another modal).

### Modal modes and accessibility

- **`modal={true}` (default)**: Delegates focus trapping and outside `aria-hidden` isolation to Base UI Popover (`modal="trap-focus"`), leaving scroll unlocked so targets inside scroll containers can be followed. Render a `CoachmarkClose` inside `CoachmarkPopup` so Base UI enables focus trapping.
- **`modal="allow-target"`**: Lets the user interact with `target` directly via a dynamic pointer cutout while marking subtrees outside the portal, target, and `[aria-live]` regions `inert` and `aria-hidden="true"` so both keyboard focus and assistive technology stay isolated to the popup and target.
- **`highlightSelectors`**: Visually expands the spotlight to cover related elements alongside `target`. Highlight parts outside `target` stay `inert` while shown; descendants of `target` remain interactive.
- **Focus per step**: Point `initialFocus` at the primary action button on walkthrough steps, or omit it on `allow-target` action steps so the dialog receives focus before the user tabs into the target.

[Base UI Popover]: https://base-ui.com/react/components/popover
