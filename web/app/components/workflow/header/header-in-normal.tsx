import type { StartNodeType } from '../nodes/start/types'
import type { RunAndHistoryProps } from './run-and-history'
import {
  useCallback,
} from 'react'
import { useNodes } from 'reactflow'
import { useInputFieldPanel } from '@/app/components/rag-pipeline/hooks'
import Divider from '../../base/divider'
import {
  useNodesInteractions,
  useNodesReadOnly,
  useWorkflowRun,
} from '../hooks'
import {
  useStore,
  useWorkflowStore,
} from '../store'
import EditingTitle from './editing-title'
import EnvButton from './env-button'
import GlobalVariableButton from './global-variable-button'
import RunAndHistory from './run-and-history'
import ScrollToSelectedNodeButton from './scroll-to-selected-node-button'
import VersionHistoryButton from './version-history-button'

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
  const setShowGlobalVariablePanel = useStore(s => s.setShowGlobalVariablePanel)
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
    setShowGlobalVariablePanel(false)
    closeAllInputFieldPanels()
  }, [workflowStore, handleBackupDraft, selectedNode, handleNodeSelect, setShowWorkflowVersionHistoryPanel, setShowEnvPanel, setShowDebugAndPreviewPanel, setShowVariableInspectPanel, setShowChatVariablePanel, setShowGlobalVariablePanel])

  return (
    <div className="flex w-full items-center justify-between">
      <div>
        <EditingTitle />
      </div>
      <div>
        <ScrollToSelectedNodeButton />
      </div>
      <div className="flex items-center gap-2">
        {components?.left}
        <Divider type="vertical" className="mx-auto h-3.5" />
        <RunAndHistory {...runAndHistoryProps} />
        <div className="shrink-0 cursor-pointer rounded-lg border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg shadow-xs backdrop-blur-[10px]">
          {components?.chatVariableTrigger}
          <EnvButton disabled={nodesReadOnly} />
          <GlobalVariableButton disabled={nodesReadOnly} />
        </div>
        {components?.middle}
        <VersionHistoryButton onClick={onStartRestoring} />
      </div>
    </div>
  )
}

export default HeaderInNormal
