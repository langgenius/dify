import { useStore } from './store'

const SyncingDataModal = () => {
  const isSyncingWorkflowDraft = useStore(s => s.isSyncingWorkflowDraft)

  if (!isSyncingWorkflowDraft)
    return null

  return (
    <div className="absolute inset-0 z-[9999]">
    </div>
  )
}

export default SyncingDataModal
