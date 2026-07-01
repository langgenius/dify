# Step-by-step Tour Frontend Design

This document defines the target frontend infrastructure for the Dify Cloud new-user step-by-step tour. It should be treated as the product and technical source of truth for the frontend work, not as a description of whichever code happens to exist today.

## Product Definition

The tour is account-level onboarding with one workspace as the initial context.

- Product surface: Dify Cloud only.
- Auto-show audience: newly registered accounts only.
- Auto-show workspace: only the first workspace the new account enters after registration.
- First workspace can be self-created or invited.
- User role does not affect auto-show eligibility.
- Switching to another workspace does not auto-show the tour by default.
- Any workspace can manually show the tour from Help menu.
- Existing account invited into a new workspace does not auto-show.
- Important locales for the first frontend slice: `en-US`, `zh-Hans`, `ja-JP`.
- English duration copy should say `about 5 minutes`.

## Frontend Principle

Frontend should model the feature as an account-level onboarding controller plus workspace-aware presentation.

Do not model this as `Record<workspaceId, state>` with every workspace defaulting to enabled. That creates the wrong product behavior: a user who switches workspaces would see the tour again by default.

The frontend can temporarily use a local placeholder while backend state is unavailable, but the placeholder should mirror the final account-level shape:

```ts
type StepByStepTourAccountState = {
  firstWorkspaceId?: string
  activeTaskId?: StepByStepTourTaskId
  activeGuideIndex?: number
  activeGuideGroup?: 'studioEmpty' | 'studioWithApps' | 'knowledgeEmpty' | 'knowledgeWithDatasets' | 'integrationEditor' | 'integrationNoPermission'
  activeGuideIndexes?: number[]
  manuallyEnabledWorkspaceIds: string[]
  manuallyDisabledWorkspaceIds: string[]
  minimized: boolean
  completedTaskIds: StepByStepTourTaskId[]
  skipped: boolean
}
```

Derived visibility:

```ts
const enabledForCurrentWorkspace = !skipped
  && !manuallyDisabledWorkspaceIds.includes(currentWorkspaceId)
  && (firstWorkspaceId === currentWorkspaceId || manuallyEnabledWorkspaceIds.includes(currentWorkspaceId))
```

`manuallyEnabledWorkspaceIds` and `manuallyDisabledWorkspaceIds` are workspace-level overrides on top of account-level onboarding:

- `manuallyEnabledWorkspaceIds`: workspaces where the user explicitly turns the tour on from Help menu. This is how a non-first workspace can show the tour.
- `manuallyDisabledWorkspaceIds`: workspaces where the user explicitly turns the tour off from Help menu. This lets the first workspace stop showing without changing `firstWorkspaceId`.
- `skipped`: account-level hide state. It hides the tour across workspaces until the user manually re-enables it.

Temporary placeholder behavior:

- Pretend the current account is a new user.
- The first workspace seen by the browser becomes `firstWorkspaceId`.
- That workspace auto-shows.
- Later workspaces do not auto-show unless manually enabled.
- This is only a frontend placeholder and should be replaced by backend account state later.

## Target Frontend Architecture

```txt
Common layout
  -> StepByStepTourMount
      -> useStepByStepTourController(currentWorkspaceId)
          -> account-level source adapter
              -> temporary local placeholder now
              -> backend query/mutation later
          -> derived visibility
          -> task routing
          -> task completion commands
      -> FloatingChecklist
      -> SpotlightLayer

HelpMenu
  -> useStepByStepTourController(currentWorkspaceId)
  -> enable/disable current workspace manually
```

Recommended ownership:

- `StepByStepTourMount`: route integration and high-level composition.
- `useStepByStepTourController`: single public hook for visibility, commands, and derived state.
- `storage.ts` or future `state.ts`: account-level state adapter. Today local placeholder, later API-backed.
- `floating-widget.tsx`: visual checklist only. No product eligibility logic.
- `target-registry.ts`: maps tasks to routes and DOM targets.
- `spotlight-layer.tsx`: overlay, target measurement, click-through rules, and fallback target rendering.
- `completion.ts`: task completion rules.

Avoid passing raw backend/local state into visual components. Visual components should receive already-derived props such as `visible`, `completedTaskIds`, `minimized`, and callbacks.

Data flow contract:

- `storage.ts` owns raw persisted account state only.
- `useStepByStepTourController` reads the source adapter, derives workspace visibility, derives task presentation state, and exposes commands.
- `StepByStepTourMount` gets the current workspace and route context, calls the controller, and passes derived props to visual components.
- `FloatingChecklist` renders task rows and calls controller commands such as start, minimize, and skip. It should not read localStorage or decide product eligibility.
- `HelpMenu` calls the same controller to enable or disable the current workspace manually.

## Product Components

### Floating Checklist

Purpose: compact, persistent entry point for the tour.

Required behavior:

- Show title, duration, progress, task rows, minimize, and skip.
- Task CTAs must be clickable.
- Clicking a CTA should route to the relevant surface and start the task target flow.
- Minimize keeps a small entry visible.
- Skip hides the tour for the account until manually re-enabled.

### Skip Recovery Hint

Purpose: after users hide the full checklist, keep the recovery path visible
long enough that the tour does not feel lost.

Required behavior:

- Clicking `Skip tour` fades the floating checklist out before the account-level
  `skipped` state removes it from the layout.
- After the checklist is hidden, show a one-time recovery bubble near the
  bottom-left Help trigger with the copy:
  `Tour hidden. Turn it back on anytime in Help → Step-by-step Tour.`
- The bubble includes a `Got it` action that dismisses only this temporary
  hint. It does not change the persisted tour state.
- While the bubble is shown, pulse the Help trigger for 2.4 seconds to draw
  attention to the recovery entry point. Respect reduced-motion preferences.
- Opening the Help menu or toggling `Step-by-step Tour` from the Help menu
  dismisses the recovery bubble.
- This recovery hint is feature-local UI state, not account persistence. Keep
  `skipped` as the durable account-level hide flag.

### Help Menu Toggle

Purpose: manual recovery and workspace opt-in.

Required behavior:

- Cloud only.
- Reflect whether the tour is enabled for the current workspace.
- Turning on enables the tour for the current workspace even if it is not the first workspace.
- Turning off disables the tour for the current workspace without changing the account's first workspace.

### Spotlight Layer

Purpose: guide attention to the actual next action after a task starts.

Required behavior:

- Register target elements by stable data attributes.
- Wait for route transitions and async rendering.
- Highlight a target or a defined fallback empty state.
- Allow click-through only when the underlying action is safe and intended.
- Never trap the user if the target is unavailable.

### Task Target Registry

Purpose: keep product task definitions declarative.

Suggested shape:

```ts
type StepByStepTourTaskDefinition = {
  id: StepByStepTourTaskId
  route: string
  target: string
  highlightPartSelectors?: string[]
  fallbackTarget?: string
  canClickThrough: boolean
  permissionFallback?: 'show-parent-empty-state' | 'show-disabled-reason'
}
```

Guides that declare `highlightPartSelectors` must keep the active tour overlay
shell mounted while measurement settles. The backdrop must not depend on
highlight-part readiness. The measured highlight and coachmark should render
only from a stable measured overlay: keep the previous stable overlay visible
while the next target, dropdown, or menu is mounting, then replace it only after
each selector has at least one visible, measurable element and the union rect has
settled. This keeps the screen and highlight from flashing while also preventing
union highlights from appearing as primary-target-only rectangles or
intermediate floating-position rects while portalled dropdowns or menus are
still mounting and positioning.

For portalled overlays, attach highlight-part attributes to a stable positioning
element rather than the animated popup surface. Dropdown popups scale during
their opening transition, so measuring the popup itself can make the tour
highlight appear to change padding even when the configured padding is constant.

Expected tasks:

- `home`: Learn Dify or Home learning surface.
- `studio`: Studio/apps page.
- `knowledge`: Knowledge/datasets page.
- `integration`: Integrations page.

### Step 1: Home / Learn Dify

Step 1 orients the user to Learn Dify on the Home surface. The task route is
`/`, which renders the Home Explore app list. The active guide target must be
the rendered Learn Dify section on that page, not just the route itself.

When the user clicks the Home task CTA from the floating checklist:

- Route to `/`.
- Minimize the floating checklist.
- Start the Home guide only after the Learn Dify section has rendered a
  matching `data-step-by-step-tour-target`.

Required target contract:

- `STEP_BY_STEP_TOUR_GUIDES.home` must contain a guide for
  `STEP_BY_STEP_TOUR_TARGETS.home`.
- The real Home Learn Dify section must expose
  `data-step-by-step-tour-target={STEP_BY_STEP_TOUR_TARGETS.home}` when it is
  rendered.
- A unit test that creates a fake Home target proves the mount/controller path,
  but it does not prove the real Home page exposes that target. The Explore
  app-list tests should also assert that the Learn Dify section carries the
  Home tour target when Learn Dify is enabled and visible.

Known regression pattern:

- If the Home guide is missing from the target registry, clicking `Show me`
  only routes to `/`; no active guide is available, so no coachmark can render.
- If the Home guide exists but the real Learn Dify section does not expose the
  target attribute, the route and state update succeed, but
  `useStepByStepTourTarget` cannot resolve the target element, so the user still
  sees no visible response.

### Step 2: Studio

Step 2 is for users who can create and manage apps, currently represented in
the frontend by the `app.create_and_management` permission. Owner, Admin, and
Editor roles are expected to have this permission, but the walkthrough should
key off the permission rather than hard-coded role names.

When the user clicks the Studio task CTA from the floating checklist:

- Route to `/apps`.
- Minimize the floating checklist.
- Start the Studio walkthrough only after the Studio surface has rendered a
  matching target.

Studio uses the same app-presence signal as the page itself. The current
frontend signal is the first apps-list page total:

```ts
const studioHasApps = (pages[0]?.total ?? 0) > 0
```

If a backend onboarding payload later exposes `studioHasApps`, it should be
treated as the same product concept and kept consistent with the Studio page's
empty-state decision. Do not introduce a second frontend definition that can
drift from the page.

#### Empty Studio Walkthrough

When `studioHasApps` is false and the user can create apps, Studio shows the
first-empty-state surface. The empty walkthrough is a display walkthrough, not
an action-completion flow. It highlights the available starting points and is
completed by the final `Got it`, not by opening one of the create dialogs.

Dynamic walkthrough step list:

1. `Create from a template` entry card.
1. `Create from blank` entry card.
1. `Import a DSL file` entry card.
1. Bottom `Learn Dify` section, only when Learn Dify is enabled and rendered.

If Learn Dify is disabled or the Learn Dify section is not rendered, the empty
walkthrough should skip that target and become a 3-step walkthrough.

#### With-apps Studio Walkthrough

When `studioHasApps` is true, Studio shows the existing app list. The with-apps
walkthrough is also a display walkthrough. It orients the user to creation and
management affordances and is completed by the final `Got it`.

Dynamic walkthrough step list:

1. Top-right `Create` trigger/action area. During this guide, automatically
   open the Create dropdown so users can see template, blank-canvas, and DSL
   import options. The primary target remains the stable trigger/action area;
   the visual highlight includes the opened dropdown as a highlight part.
1. First workspace app card in the main app list, only when an app card target
   is rendered. During this guide, automatically show the card action bar and
   open its more-actions menu. The primary target remains the stable card; the
   visual highlight includes the opened menu as a highlight part.

If no workspace app card target is rendered, the with-apps walkthrough should
skip that optional target and become a 1-step walkthrough.

### Step 3: Knowledge

Step 3 is for users who can create knowledge bases and connect external
knowledge bases. The current frontend permission gates are:

- `dataset.create_and_management`: shows the ready-to-use and custom knowledge
  base entry cards, and allows `/datasets/create` and
  `/datasets/create-from-pipeline`.
- `dataset.external.connect`: shows the external knowledge base entry card,
  allows `/datasets/connect`, and enables external knowledge API queries.

The first implementation slice only starts the Knowledge empty walkthrough when
both permissions are present, so all three empty-state entry cards are visible.
In the legacy role snapshots this covers Owner, Admin, Editor, and Dataset
Operator. Normal users can still enter the Knowledge list route, but they do not
see these empty-state actions, and their no-permission tour behavior should be
handled later by the shared no-permission flow.

When the user clicks the Knowledge task CTA from the floating checklist:

- Route to `/datasets`.
- Minimize the floating checklist.
- The Knowledge task row does not show a `Learn more` secondary action.
- After the Knowledge list first page resolves, set `activeGuideGroup` from the
  page's own state: `knowledgeEmpty` when the no-filter empty state is rendered,
  or `knowledgeWithDatasets` when at least one knowledge base exists.

#### Empty Knowledge Walkthrough

When there are no knowledge bases, no active filters, and all three entry
actions are visible, Knowledge shows a 3-step display walkthrough:

1. `Create a ready-to-use knowledge base` entry card.
1. `Build a custom knowledge base` entry card.
1. `Connect to an external knowledge base` entry card.

The walkthrough is completed by the final `Got it`, not by navigating into one
of the creation flows. Partial-permission variants are intentionally out of
scope for this slice and should be covered by the future shared permission
fallback behavior.

#### With-datasets Knowledge Walkthrough

When at least one knowledge base exists and the user has both Knowledge
walkthrough permissions, Knowledge shows a 2-step display walkthrough:

1. Top-right `Create` trigger/action area. During this guide, automatically
   open the Create dropdown so users can see ready-to-use creation, custom
   pipeline creation, and external connection options. The primary target
   remains the stable trigger/action area; the visual highlight includes the
   opened dropdown as a highlight part.
1. First knowledge card in the main list, only when a card target is rendered.
   During this guide, automatically show the card operations menu. The primary
   target remains the stable card; the visual highlight includes the opened
   operations menu as a highlight part.

If no knowledge card target is rendered, the with-datasets walkthrough should
skip that optional target and become a 1-step walkthrough.

### Step 4: Integration

Step 4 orients users to the Integrations page and the major integration
categories available there.

When the user clicks the Integration task CTA from the floating checklist:

- Route to `/integrations/model-provider`.
- Minimize the floating checklist.
- Start a 14-step display walkthrough.
- The first active category is Model Provider.
- As each guide becomes active, the Integrations sidebar active item must
  follow the guide's category, the right content area must render that category,
  and the active target should scroll into view.

Integration walkthrough step list:

1. Model Provider: AI Credits card.
1. Model Provider: first configured provider card, or the first provider card
   available when no provider is configured.
1. Model Provider: bottom Install model providers area.
1. Tool Plugin: top-right Auto-update action.
1. Tool Plugin: first visible tool/plugin card.
1. MCP: Add MCP Server action or create card.
1. MCP: first visible MCP server card.
1. Workflow as Tool: card grid/content area. This step shows Learn more.
1. Swagger API as Tool: card grid/content area. This step shows Learn more.
1. Data Source: first visible data source group card, or the empty setup card.
   This step shows Learn more.
1. Trigger: card grid/content area or empty state. This step shows Learn more.
1. Agent Strategy: content area or empty state. This step shows Learn more.
1. Extension: card grid/content area or empty state. This step shows Learn more.
1. Custom Endpoint: empty explanation card or first configured endpoint. This
   step shows Learn more.

Some Integration steps are optional because they only make sense when the
underlying target exists. Today this includes the bottom Install model
providers area and the first MCP server card. The lightweight implementation
does not prefetch every Integration category before the walkthrough starts.
Instead, it initializes the current session with the role-specific raw guide
indexes and lazily removes an optional guide when the active category renders
without that target.

Known trade-off: users do not see the skipped optional coachmark, but the
visible total can change after the skip point. For example, an admin may see
`2 of 14`; if the Install model providers target is not rendered, the next
visible step becomes `3 of 13`. Avoiding this would require precomputing the
complete visible guide plan before the first coachmark, which means adding
Integration data dependencies or target registration across categories to the
global tour controller.

Empty states are different from optional missing targets. If a feature exists
for the current role but its list is empty, the walkthrough should keep the
step and target the empty state or create/setup entry. Swagger API as Tool,
Workflow as Tool, Trigger, Agent Strategy, Extension, and Custom Endpoint use
this pattern rather than being pruned from the guide plan.

Required target contract:

- Integration guides declare the `integrationSection` they belong to.
- `StepByStepTourMount` synchronizes the active guide's section to the route
  with `buildIntegrationPath(...)`.
- The Integrations page remains the owner of sidebar active state; the tour
  should not duplicate sidebar state.
- Targets use stable `data-step-by-step-tour-target` attributes on existing
  semantic containers, not brittle CSS selectors.

#### Composite Highlight Rules

Composite highlights must separate positioning from visual coverage:

- `anchorRect`: only the primary target. This is used for coachmark placement
  and arrow alignment.
- `highlightRect`: union of the primary target and all visible
  `highlightPartSelectors`. This is used for the mask/highlight.

Do not use the union rect as the coachmark anchor. For the Create guide, the
primary target is the Create button and the dropdown is only a highlight part.
For the app-management guide, the primary target is the app card and the
actions menu is only a highlight part. If coachmark placement is based on the
union rect, dropdown/menu height will push the bubble away from the real
semantic target.

When unioning highlight parts:

- Compute the union from the outer edges:
  `left = min(lefts)`, `top = min(tops)`, `right = max(rights)`,
  `bottom = max(bottoms)`.
- Derive `width = right - left` and `height = bottom - top`.
- Apply configured highlight padding only after the union is computed.
- Measure the stable portalled positioner when possible, not the animated popup
  surface.

The overlay should avoid both flicker and runaway measurement:

- Do not render a primary-target-only highlight for a guide that declares
  required highlight parts.
- Keep the previous stable overlay visible while the next target or highlight
  parts are mounting and settling.
- Do not use a permanent per-frame measurement loop. Prefer event-driven
  measurement from target resize, scroll/resize, mutation, and explicit
  positioner movement signals.
- Disable dropdown/menu opening motion only for tour-driven auto-open states
  when the animation itself changes measured geometry.

`Skip walkthrough` during any Studio guide exits the active Studio walkthrough,
keeps the floating checklist minimized, and does not mark Studio complete.
The full checklist `Skip tour` remains the account-level skip.

### Completion Controller

Purpose: persist progress based on product-approved completion rules.

Completion should be explicit per task. Do not assume every CTA click means completion unless PM accepts "visited" as completion.

Possible first rules:

- `home`: completed after user opens the Learn Dify lesson or lands on the chosen learning surface.
- `studio`: completed after the final guide in the active Studio walkthrough. Empty Studio currently completes after the final `Got it` in the empty walkthrough.
- `knowledge`: completed after the final guide in the active Knowledge walkthrough. Empty Knowledge and with-datasets Knowledge both currently complete after the final `Got it`.
- `integration`: completed after the final guide in the Integration walkthrough.

## Placeholder Versus Future Backend

Backend is out of scope for this frontend branch, so frontend should use a placeholder that mimics backend behavior.

Placeholder source:

- localStorage
- account-level shape
- assumes current account is newly registered
- captures the first seen workspace as `firstWorkspaceId`

Future backend source:

- generated API query/mutation
- account-level eligibility decided by backend
- cross-device persistence for skipped, completed, and manually enabled workspaces

The frontend adapter should be swappable:

```txt
useStepByStepTourController
  -> useStepByStepTourSource
      -> local placeholder now
      -> backend API later
```

The rest of the UI should not care which source is active.

## Route And Permission Rules

Initial route rules:

- Show in common shell surfaces where onboarding is useful.
- Hide on app detail routes such as `/app/`.
- Hide during plugin install routes such as `/installed/`.

Permission recommendation:

- Do not hide the whole tour because one task is unavailable.
- For this frontend slice, do not hide unavailable tasks. Show the task row in a disabled state with a reason when the user's role cannot perform it.
- Prefer task-level fallbacks:
  - route to parent page and highlight empty state
  - disable row with reason

Open questions:

- Should account settings, billing, invite flow, and provider setup hide the tour?
- Should manual enable show on all common pages or only Home?
- Should skip mean "never auto-show again" or "hide until Help menu re-enables"?
- Which tasks are visit-based versus action-based completion?

## Implementation Slices

### Slice 1: Frontend Shell With Correct Placeholder

- Account-level placeholder state.
- First seen workspace auto-shows.
- Other workspaces default hidden.
- Help menu can manually enable current workspace.
- Floating checklist renders and task CTAs route.
- Key locale copy exists.
- Current widget implementation can receive copy through props first; full locale wiring can follow after the visual and interaction contract is approved.

### Slice 2: Controller Cleanup

- Introduce `useStepByStepTourController`.
- Move task route mapping out of mount component.
- Keep visual widget product-logic-free.

### Slice 3: Spotlight Infrastructure

- Add target registry.
- Add target data attributes to product surfaces.
- Add overlay with fallback target behavior.
- Studio empty walkthrough is the first multi-guide slice. It should use the
  same empty-state signal as Studio, dynamically skip the optional Learn Dify
  target when that section is not rendered, and keep the minimized tour visible
  without completing when a required empty-state target is unavailable. This
  rule covers the empty state only; the non-empty Studio target list will be
  defined separately.

### Slice 4: Completion Rules

- Add task-specific completion detection.
- Persist completed tasks through the source adapter.

### Slice 5: Backend Adapter

- Replace local placeholder with generated API query/mutation.
- Keep public controller shape stable.

## Review Checklist

- Does the tour auto-show only for the first workspace in the placeholder?
- Does switching workspace default to hidden?
- Can Help menu manually enable the tour in a non-first workspace?
- Does disabling from Help menu affect only the current workspace?
- Does skip hide the account-level tour until manual re-enable?
- Are visual components free of eligibility logic?
- Is localStorage clearly treated as a temporary source adapter?
