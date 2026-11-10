import { useWorkflowAppSelector } from '@/app/components/workflow-app/store/workflow'
import { useDifyBuilderEnabled } from '../use-enabled'

export function useWorkflowDifyBuilderEnabled() {
  const enabled = useDifyBuilderEnabled()
  const releasingDraft = useWorkflowAppSelector(
    (state) => state.workflowDraftSyncPhase === 'releasing',
  )
  return enabled && !releasingDraft
}
