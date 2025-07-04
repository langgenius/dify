import {
  useCallback,
} from 'react'
import { useNodes } from 'reactflow'
import {
  useStore,
  useWorkflowStore,
} from '../store'
import type { StartNodeType } from '../nodes/start/types'
import {
  useNodesInteractions,
  useNodesReadOnly,
  useWorkflowRun,
} from '../hooks'
import Divider from '../../base/divider'
import RunAndHistory from './run-and-history'
import EditingTitle from './editing-title'
import EnvButton from './env-button'
import VersionHistoryButton from './version-history-button'

export type HeaderInNormalProps = {
  components?: {
    left?: React.ReactNode
    middle?: React.ReactNode
  }
}
const HeaderInNormal = ({
  components,
}: HeaderInNormalProps) => {
  const workflowStore = useWorkflowStore()
  const { nodesReadOnly } = useNodesReadOnly()
  const { handleNodeSelect } = useNodesInteractions()
  const setShowWorkflowVersionHistoryPanel = useStore(s => s.setShowWorkflowVersionHistoryPanel)
  const setShowEnvPanel = useStore(s => s.setShowEnvPanel)
  const setShowDebugAndPreviewPanel = useStore(s => s.setShowDebugAndPreviewPanel)
  const setShowVariableInspectPanel = useStore(s => s.setShowVariableInspectPanel)
  const setShowChatVariablePanel = useStore(s => s.setShowChatVariablePanel)
  const nodes = useNodes<StartNodeType>()
  const selectedNode = nodes.find(node => node.data.selected)
  const { handleBackupDraft } = useWorkflowRun()

  const onStartRestoring = useCallback(() => {
    workflowStore.setState({ isRestoring: true })
    handleBackupDraft()
    // clear right panel
    if (selectedNode)
      handleNodeSelect(selectedNode.id, true)
    setShowWorkflowVersionHistoryPanel(true)
    setShowEnvPanel(false)
    setShowDebugAndPreviewPanel(false)
    setShowVariableInspectPanel(false)
    setShowChatVariablePanel(false)
  }, [handleBackupDraft, workflowStore, handleNodeSelect, selectedNode,
    setShowWorkflowVersionHistoryPanel, setShowEnvPanel, setShowDebugAndPreviewPanel, setShowVariableInspectPanel])

  return (
    <>
      <div>
        <EditingTitle />
      </div>
      <div className='flex items-center gap-2'>
        {components?.left}
        <EnvButton disabled={nodesReadOnly} />
        <Divider type='vertical' className='mx-auto h-3.5' />
        <RunAndHistory />
        {components?.middle}
        <VersionHistoryButton onClick={onStartRestoring} />
      </div>
    </>
  )
}

export default HeaderInNormal
