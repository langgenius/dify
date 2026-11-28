# Coachmark

`Coachmark` guides users through elements that already exist on the page. It is built on [Base UI Popover], which owns portal stacking, floating positioning, collision avoidance, arrow placement, Escape and close dismissal, transition lifecycles, and `role="dialog"` semantics.

Dify UI owns the guided-tour contract on top of Popover: target readiness, highlight union geometry, step snapshots across pending transitions, modal-layer coexistence, and target-preserving isolation.

## Ownership and Contracts

### Controlled state and `payload`

The caller owns step state and passes `open`, `target` (`Element | string | null`), and optionally `payload`:

- Pass `payload` with a render-function child (`({ payload }) => ...`) whenever step transitions may wait on a mounting or animating target. `Coachmark` freezes the previous step's payload while `data-pending` / `aria-busy` is active and while the close transition runs.
- `payload` accepts `Payload | undefined` and infers `Payload` as the non-`undefined` type. When `open={false}` or while the next step's data is not ready, pass `payload={undefined}` instead of fabricating a fallback or conditionally unmounting `<Coachmark>`.
- `onOpenChange` reports only `'close-press'` and `'escape-key'`; outside clicks never dismiss a coachmark.
- `onStepShown` runs each time a step becomes shown, including when returning after stepping aside for another modal.

### Layering and positioning

- `CoachmarkPositioner` accepts logical sides only (`top`, `bottom`, `inline-start`, `inline-end`) and stays fixed to match the viewport spotlight and blocker layers.
- When a target scrolls outside its scroll container, the popup remains visible and reachable so dismissal controls stay accessible.
- When another modal covers the coachmark, it steps aside until the target is reachable again.

### Modal modes and accessibility

- **`modal={true}` (default)**: Delegates focus trapping and outside isolation to Base UI Popover while leaving scroll unlocked so targets inside scroll containers can be followed. Render a `CoachmarkClose` inside `CoachmarkPopup` so focus trapping stays active.
- **`modal="allow-target"`**: Lets the user interact with `target` directly while blocking and isolating the rest of the page from pointer, keyboard, and assistive-technology navigation.
- **`highlightSelectors`**: Visually expands the spotlight to cover related elements alongside `target`. Highlight parts outside `target` stay inert while shown; descendants of `target` remain interactive.
- **Focus and announcements**: Point `initialFocus` at the primary action on walkthrough steps, or omit it on `allow-target` action steps so the dialog receives focus before the user tabs into the target. Step transitions announce updated copy to assistive technology even when focus stays on the same action control across consecutive steps.

[Base UI Popover]: https://base-ui.com/react/components/popover
