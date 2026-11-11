import type { ContextMenuActions } from '@langgenius/dify-ui/context-menu'
import type { NodeProps } from 'reactflow'
import type { Edge, Node } from '../../types'
import { ContextMenu, ContextMenuTrigger } from '@langgenius/dify-ui/context-menu'
import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { useStoreApi } from 'reactflow'
import { CanvasNodesCatalogProbe } from '../../__tests__/canvas-nodes-catalog-probe'
import { EdgeContextmenu } from '../../edge-contextmenu'
import { useEdgesInteractions } from '../../hooks/use-edges-interactions'
import { useNodeKeyboardInteractions } from '../../hooks/use-node-keyboard-interactions'
import { useNodesInteractions } from '../../hooks/use-nodes-interactions'
import { useSelectionInteractions } from '../../hooks/use-selection-interactions'
import { NodeActionsMenu } from '../../node-actions-menu'
import { NodeActionsContextMenuContent } from '../../node-actions-menu/context-menu-content'
import { NoteEditor, NoteEditorContextProvider } from '../../note-node/note-editor'
import NoteOperator from '../../note-node/note-editor/toolbar/operator'
import { SelectionContextmenu } from '../../selection-contextmenu'
import { WorkflowCanvas } from '../workflow-canvas'
import 'reactflow/dist/style.css'

function NodeWithMenu({ id, data }: NodeProps) {
  return (
    <div className="nodrag nopan">
      Workflow node
      <NodeActionsMenu id={id} data={data} showHelpLink={false} />
    </div>
  )
}

function NoteWithMenu({ id }: NodeProps) {
  const { handleNodesCopy, handleNodesDuplicate, handleNodeDelete } = useNodesInteractions()
  return (
    <div className="nodrag nopan">
      Note node
      <NoteOperator
        onCopy={() => handleNodesCopy(id)}
        onDuplicate={() => handleNodesDuplicate(id)}
        onDelete={() => handleNodeDelete(id)}
        showAuthor={false}
        onShowAuthorChange={() => {}}
      />
    </div>
  )
}

const nodeTypes = { menu: NodeWithMenu, note: NoteWithMenu }

export type CanvasProps = {
  nodes: Node[]
  edges: Edge[]
  contextMenuType?: 'node' | 'edge' | 'selection'
}

type FlowApi = ReturnType<typeof useStoreApi>
export type FlowHandle = { current?: FlowApi }

export function WorkflowCanvasFixture({
  nodes,
  edges,
  contextMenuType,
  flowHandle,
}: CanvasProps & { flowHandle: FlowHandle }) {
  flowHandle.current = useStoreApi()
  const { handleSelectionStart, handleSelectionChange, handleSelectionContextMenu } =
    useSelectionInteractions()
  const contextMenuActionsRef = useRef<ContextMenuActions>(null)
  const { handleNodeSelect } = useNodesInteractions()
  const { handleEdgeContextMenu } = useEdgesInteractions()
  const onKeyDownCapture = useNodeKeyboardInteractions(handleNodeSelect)

  return (
    <>
      <ContextMenu actionsRef={contextMenuActionsRef}>
        <ContextMenuTrigger render={<div style={{ width: 800, height: 500 }} />}>
          <WorkflowCanvas
            defaultNodes={nodes}
            defaultEdges={edges}
            nodeTypes={nodeTypes}
            onNodeClick={(_, node) => handleNodeSelect(node.id)}
            deleteKeyCode={null}
            onKeyDownCapture={onKeyDownCapture}
            selectionOnDrag={contextMenuType === 'selection'}
            panOnDrag={contextMenuType !== 'selection'}
            onSelectionStart={handleSelectionStart}
            onSelectionChange={handleSelectionChange}
            onSelectionContextMenu={handleSelectionContextMenu}
            selectionKeyCode={null}
            multiSelectionKeyCode={null}
            onEdgeContextMenu={handleEdgeContextMenu}
          >
            <textarea
              aria-label="Node prompt"
              style={{ position: 'absolute', zIndex: 5, top: 20, left: 20 }}
            />
            <div
              style={{
                position: 'absolute',
                zIndex: 5,
                top: 80,
                left: 20,
                width: 240,
                minHeight: 80,
              }}
            >
              <NoteEditorContextProvider>
                <NoteEditor containerElement={null} />
              </NoteEditorContextProvider>
            </div>
            {createPortal(<button>Popup action</button>, document.body)}
          </WorkflowCanvas>
        </ContextMenuTrigger>
        {contextMenuType === 'node' ? (
          <NodeActionsContextMenuContent
            id="node"
            data={nodes[0]!.data}
            onClose={() => contextMenuActionsRef.current?.close()}
            showHelpLink={false}
          />
        ) : contextMenuType === 'edge' ? (
          <EdgeContextmenu onClose={() => contextMenuActionsRef.current?.close()} />
        ) : contextMenuType === 'selection' ? (
          <SelectionContextmenu onClose={() => contextMenuActionsRef.current?.close()} />
        ) : null}
      </ContextMenu>
      <input aria-label="Outside canvas input" />
      <CanvasNodesCatalogProbe />
    </>
  )
}
