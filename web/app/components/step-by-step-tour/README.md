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
  fallbackTarget?: string
  canClickThrough: boolean
  permissionFallback?: 'show-parent-empty-state' | 'show-disabled-reason'
}
```

Expected tasks:

- `home`: Learn Dify or Home learning surface.
- `studio`: Studio/apps page.
- `knowledge`: Knowledge/datasets page.
- `integration`: Integrations page.

### Completion Controller

Purpose: persist progress based on product-approved completion rules.

Completion should be explicit per task. Do not assume every CTA click means completion unless PM accepts "visited" as completion.

Possible first rules:

- `home`: completed after user opens the Learn Dify lesson or lands on the chosen learning surface.
- `studio`: completed after user visits Studio/apps page.
- `knowledge`: completed after user visits Knowledge page, opens a dataset, or creates one. PM decision needed.
- `integration`: completed after user visits Integrations page or reaches a valid fallback empty state. PM decision needed.

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
