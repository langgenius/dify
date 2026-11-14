import type { StepByStepTourStatePatchPayload } from '@dify/contracts/api/console/onboarding/types.gen'
import type { consoleClient } from '@/service/console'
import { vi } from 'vite-plus/test'

type StepByStepTourStateResponse = Awaited<
  ReturnType<typeof consoleClient.onboarding.stepByStepTour.state.get>
>

/** In-memory responses for the onboarding API, shared by its independent UI consumers. */
export function createStepByStepTourService(
  defaults: Partial<StepByStepTourStateResponse> = {},
  workspaceId = 'workspace-1',
) {
  const createState = (
    overrides: Partial<StepByStepTourStateResponse> = {},
  ): StepByStepTourStateResponse => ({
    first_workspace_id: workspaceId,
    skipped: false,
    completed_task_ids: [],
    manually_enabled_workspace_ids: [],
    manually_disabled_workspace_ids: [],
    updated_at: '2026-07-01T00:00:00Z',
    ...defaults,
    ...Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined)),
  })
  let state = createState()
  const patch = async ({ body }: { body: StepByStepTourStatePatchPayload }) => {
    switch (body.action) {
      case 'complete_task':
        state = {
          ...state,
          completed_task_ids: body.task_id
            ? Array.from(new Set([...(state.completed_task_ids ?? []), body.task_id]))
            : state.completed_task_ids,
        }
        break
      case 'uncomplete_task':
        state = {
          ...state,
          completed_task_ids: (state.completed_task_ids ?? []).filter((id) => id !== body.task_id),
        }
        break
      case 'skip':
        state = {
          ...state,
          skipped: true,
          manually_enabled_workspace_ids: (state.manually_enabled_workspace_ids ?? []).filter(
            (id) => id !== workspaceId,
          ),
        }
        break
      case 'enable_current_workspace':
        state = {
          ...state,
          skipped: false,
          manually_enabled_workspace_ids: Array.from(
            new Set([...(state.manually_enabled_workspace_ids ?? []), workspaceId]),
          ),
          manually_disabled_workspace_ids: (state.manually_disabled_workspace_ids ?? []).filter(
            (id) => id !== workspaceId,
          ),
        }
        break
      case 'disable_current_workspace':
        state = {
          ...state,
          manually_enabled_workspace_ids: (state.manually_enabled_workspace_ids ?? []).filter(
            (id) => id !== workspaceId,
          ),
          manually_disabled_workspace_ids: Array.from(
            new Set([...(state.manually_disabled_workspace_ids ?? []), workspaceId]),
          ),
        }
        break
    }
    return state
  }
  const patchState = vi.fn(patch)
  return {
    get state() {
      return state
    },
    patchState,
    reset() {
      state = createState()
      patchState.mockReset().mockImplementation(patch)
    },
    setState(overrides: Partial<StepByStepTourStateResponse>) {
      state = createState(overrides)
    },
  }
}
