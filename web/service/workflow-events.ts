import type { StreamRequest } from './event-stream'
import { consoleClient } from './console'

// The backend reads these flags from the query string, but the generated contracts do not
// declare them; the client still serializes `query` for `detailed` inputs.
const resumeQuery = { include_state_snapshot: 'true', continue_on_pause: 'true' }

/**
 * Requests the events of a paused or running workflow run, replaying its state first and
 * keeping the stream open across pauses.
 */
export function workflowRunEventsRequest(
  workflowRunId: string,
  { isPublicAPI = false }: { isPublicAPI?: boolean } = {},
): StreamRequest {
  if (isPublicAPI) {
    // Loaded on demand so console bundles do not include the WebApp contract.
    return (options) =>
      import('./webapp-client').then(({ webAppClient }) =>
        webAppClient.workflow.byTaskId.events.get(
          { params: { task_id: workflowRunId }, query: resumeQuery } as {
            params: { task_id: string }
          },
          options,
        ),
      )
  }
  return (options) =>
    consoleClient.workflow.byWorkflowRunId.events.get(
      { params: { workflow_run_id: workflowRunId }, query: resumeQuery } as {
        params: { workflow_run_id: string }
      },
      options,
    )
}
