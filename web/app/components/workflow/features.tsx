import {
  memo,
  useCallback,
} from 'react'
import { useStore } from './store'
import {
  useIsChatMode,
  useNodesReadOnly,
  useNodesSyncDraft,
} from './hooks'
import NewFeaturePanel from '@/app/components/base/features/new-feature-panel'

const Features = () => {
  const setShowFeaturesPanel = useStore(s => s.setShowFeaturesPanel)
  const isChatMode = useIsChatMode()
  const { nodesReadOnly } = useNodesReadOnly()
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()

  const handleFeaturesChange = useCallback(() => {
    handleSyncWorkflowDraft()
    setShowFeaturesPanel(true)
  }, [handleSyncWorkflowDraft, setShowFeaturesPanel])

  return (
    <NewFeaturePanel
      show
      isChatMode={isChatMode}
      disabled={nodesReadOnly}
      onChange={handleFeaturesChange}
      onClose={() => setShowFeaturesPanel(false)}
    />
  )
}

export default memo(Features)
