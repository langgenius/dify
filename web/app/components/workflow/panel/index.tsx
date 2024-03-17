import type { FC } from 'react'
import {
  memo,
  useMemo,
} from 'react'
import { useNodes } from 'reactflow'
import type { CommonNodeType } from '../types'
import { Panel as NodePanel } from '../nodes'
import { useStore } from '../store'
import { useIsChatMode } from '../hooks'
import WorkflowInfo from './workflow-info'
import DebugAndPreview from './debug-and-preview'
import RunHistory from './run-history'
import Record from './record'
import InputsPanel from './inputs-panel'

const Panel: FC = () => {
  const nodes = useNodes<CommonNodeType>()
  const isChatMode = useIsChatMode()
  const runningStatus = useStore(s => s.runningStatus)
  const workflowRunId = useStore(s => s.workflowRunId)
  const selectedNode = nodes.find(node => node.data.selected)
  const showRunHistory = useStore(state => state.showRunHistory)
  const showInputsPanel = useStore(s => s.showInputsPanel)
  const {
    showWorkflowInfoPanel,
    showNodePanel,
    showDebugAndPreviewPanel,
  } = useMemo(() => {
    return {
      showWorkflowInfoPanel: !isChatMode && !selectedNode && !runningStatus,
      showNodePanel: !!selectedNode && !runningStatus,
      showDebugAndPreviewPanel: isChatMode && runningStatus && !showRunHistory,
    }
  }, [selectedNode, isChatMode, runningStatus, showRunHistory])

  return (
    <div
      className={`
        absolute top-14 right-0 bottom-2 flex pr-2 z-10
        ${(showRunHistory || showDebugAndPreviewPanel) && '!pr-0'}
      `}
    >
      {
        showInputsPanel && (
          <InputsPanel />
        )
      }
      {
        runningStatus && !isChatMode && workflowRunId && (
          <Record />
        )
      }
      {
        runningStatus && isChatMode && showRunHistory && (
          <Record />
        )
      }
      {
        showNodePanel && (
          <NodePanel {...selectedNode!} />
        )
      }
      {
        showWorkflowInfoPanel && (
          <WorkflowInfo />
        )
      }
      {
        showDebugAndPreviewPanel && (
          <DebugAndPreview />
        )
      }
      {
        showRunHistory && (
          <RunHistory />
        )
      }
    </div>
  )
}

export default memo(Panel)
