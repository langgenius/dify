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
import type { RunAndHistoryProps } from './run-and-history'
import RunAndHistory from './run-and-history'
import EditingTitle from './editing-title'
import EnvButton from './env-button'
import VersionHistoryButton from './version-history-button'
import { useInputFieldPanel } from '@/app/components/rag-pipeline/hooks'
import ScrollToSelectedNodeButton from './scroll-to-selected-node-button'

export type HeaderInNormalProps = {
  components?: {
    left?: React.ReactNode
    middle?: React.ReactNode
    chatVariableTrigger?: React.ReactNode
  }
  runAndHistoryProps?: RunAndHistoryProps
}
const HeaderInNormal = ({
  components,
  runAndHistoryProps,
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
  const { closeAllInputFieldPanels } = useInputFieldPanel()

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
    closeAllInputFieldPanels()
  }, [workflowStore, handleBackupDraft, selectedNode, handleNodeSelect, setShowWorkflowVersionHistoryPanel, setShowEnvPanel, setShowDebugAndPreviewPanel, setShowVariableInspectPanel, setShowChatVariablePanel])

  return (
    <div className='flex w-full items-center justify-between'>
      <div>
        <EditingTitle />
      </div>
      <div>
        <ScrollToSelectedNodeButton />
      </div>
      <div className='flex items-center gap-2'>
        {components?.left}
        <Divider type='vertical' className='mx-auto h-3.5' />
        <RunAndHistory {...runAndHistoryProps} />
        <div className='cursor-pointer rounded-lg border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg shadow-xs backdrop-blur-[10px]'>
          {components?.chatVariableTrigger}
          <EnvButton disabled={nodesReadOnly} />
        </div>
        {components?.middle}
        <VersionHistoryButton onClick={onStartRestoring} />
      </div>
    </div>
  )
}

export default HeaderInNormal
