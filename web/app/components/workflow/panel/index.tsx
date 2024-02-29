import type { FC } from 'react'
import {
  memo,
  useMemo,
} from 'react'
import { useNodes } from 'reactflow'
import type { CommonNodeType } from '../types'
import { Panel as NodePanel } from '../nodes'
import { useStore } from '../store'
import WorkflowInfo from './workflow-info'
import DebugAndPreview from './debug-and-preview'
import RunHistory from './run-history'
import Record from './record'

const Panel: FC = () => {
  const mode = useStore(state => state.mode)
  const runStaus = useStore(state => state.runStaus)
  const nodes = useNodes<CommonNodeType>()
  const selectedNode = nodes.find(node => node.selected)
  const showRunHistory = useStore(state => state.showRunHistory)
  const {
    showWorkflowInfoPanel,
    showNodePanel,
    showDebugAndPreviewPanel,
  } = useMemo(() => {
    return {
      showWorkflowInfoPanel: mode === 'workflow' && !selectedNode,
      showNodePanel: !!selectedNode,
      showDebugAndPreviewPanel: mode === 'chatbot' && !selectedNode,
    }
  }, [mode, selectedNode])

  return (
    <div className='absolute top-14 right-0 bottom-2 flex z-10'>
      {
        runStaus && (
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
