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

const Panel: FC = () => {
  const isChatMode = useIsChatMode()
  const runTaskId = useStore(state => state.runTaskId)
  const nodes = useNodes<CommonNodeType>()
  const selectedNode = nodes.find(node => node.data._selected)
  const showRunHistory = useStore(state => state.showRunHistory)
  const {
    showWorkflowInfoPanel,
    showNodePanel,
    showDebugAndPreviewPanel,
  } = useMemo(() => {
    return {
      showWorkflowInfoPanel: !isChatMode && !selectedNode && !runTaskId,
      showNodePanel: !!selectedNode && !runTaskId,
      showDebugAndPreviewPanel: isChatMode && !selectedNode && !runTaskId,
    }
  }, [selectedNode, isChatMode, runTaskId])

  return (
    <div className='absolute top-14 right-0 bottom-2 flex z-10'>
      {
        runTaskId && (
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
