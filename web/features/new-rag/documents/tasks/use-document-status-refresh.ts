import { useQueryClient } from '@tanstack/react-query'
import { useAtomValueRawSync } from 'jotai'
import { useEffect, useRef } from 'react'
import { consoleQuery } from '@/service/console'
import { taskIsActive } from '../model'
import { DOCUMENT_FILTERS } from '../query-state'
import { taskPermissionDeniedAtom } from '../state/queries'
import { effectiveTasksAtom } from './state'

/** Keep server-filtered membership in sync with accepted stream and polling snapshots. */
export function useDocumentStatusRefresh({
  knowledgeSpaceId,
  permissionDenied,
}: {
  knowledgeSpaceId: string
  permissionDenied: boolean
}) {
  const queryClient = useQueryClient()
  const tasks = useAtomValueRawSync(effectiveTasksAtom)
  const taskPermissionDenied = useAtomValueRawSync(taskPermissionDeniedAtom)
  const previousRef = useRef<{ spaceId: string; states: Map<string, string> } | null>(null)

  useEffect(() => {
    const previousStates =
      previousRef.current?.spaceId === knowledgeSpaceId ? previousRef.current.states : undefined
    const states = new Map<string, string>()
    let changed = false
    for (const task of tasks) {
      const status =
        task.state === 'running' ? 'processing' : taskIsActive(task) ? 'queued' : task.state
      states.set(task.id, status)
      const previousStatus = previousStates?.get(task.id)
      // Terminal transitions already refresh documents through the task runtime. Percentage
      // updates and transitions within queued states do not change filter membership.
      if (previousStatus !== undefined && previousStatus !== status && taskIsActive(task))
        changed = true
    }
    previousRef.current = { spaceId: knowledgeSpaceId, states }
    if (!changed || permissionDenied || taskPermissionDenied) return

    // Invalidate inactive filters too, while leaving unfiltered/search-only lists alone.
    void Promise.allSettled(
      DOCUMENT_FILTERS.filter((status) => status !== 'all').map((status) =>
        queryClient.invalidateQueries({
          queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.get.key({
            type: 'infinite',
            input: { params: { control_space_id: knowledgeSpaceId }, query: { status } },
          }),
        }),
      ),
    )
  }, [knowledgeSpaceId, permissionDenied, queryClient, taskPermissionDenied, tasks])
}
