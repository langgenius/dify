import type { WorkflowNodesMap } from '../node'
import type { NodeOutPutVar } from '@/app/components/workflow/types'
import { act, waitFor } from '@testing-library/react'
import { $getRoot, $nodesOfType } from 'lexical'
import { useState } from 'react'
import { Type } from '@/app/components/workflow/nodes/llm/types'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import {
  getNodeCount,
  readEditorStateValue,
  renderLexicalEditor,
  setEditorRootText,
  waitForEditorReady,
} from '../../__tests__/test-helpers'
import { CustomTextNode } from '../../custom-text/node'
import { WorkflowVariableBlockNode } from '../node'
import WorkflowVariableBlockReplacementBlock from '../workflow-variable-block-replacement-block'

const variables: NodeOutPutVar[] = [
  {
    nodeId: 'env',
    title: 'ENV',
    vars: [{ variable: 'env.key', type: VarType.string }],
  },
  {
    nodeId: 'conversation',
    title: 'Conversation',
    vars: [{ variable: 'conversation.topic', type: VarType.string }],
  },
  {
    nodeId: 'node-1',
    title: 'Node A',
    vars: [
      { variable: 'output', type: VarType.string },
      { variable: 'ragVarA', type: VarType.string, isRagVariable: true },
    ],
  },
  {
    nodeId: 'rag',
    title: 'RAG',
    vars: [{ variable: 'rag.shared.answer', type: VarType.string, isRagVariable: true }],
  },
]

const workflowNodesMap: WorkflowNodesMap = {
  'node-1': {
    title: 'Node A',
    type: BlockEnum.LLM,
    width: 200,
    height: 100,
    position: { x: 20, y: 40 },
  },
}

it('replaces multiple variables while retaining surrounding text and variable metadata', async () => {
  const onInsert = vi.fn()
  const getVarType = () => Type.string
  const { getEditor } = renderLexicalEditor({
    namespace: 'workflow-replacement',
    nodes: [CustomTextNode, WorkflowVariableBlockNode],
    children: (
      <WorkflowVariableBlockReplacementBlock
        workflowNodesMap={workflowNodesMap}
        variables={variables}
        getVarType={getVarType}
        onInsert={onInsert}
      />
    ),
  })
  const editor = await waitForEditorReady(getEditor)
  const text = 'prefix {{#node-1.output#}} and {{#env.key#}} suffix'
  setEditorRootText(editor, text, (value) => new CustomTextNode(value))
  await waitFor(() => expect(getNodeCount(editor, WorkflowVariableBlockNode)).toBe(2))
  expect(readEditorStateValue(editor, () => $getRoot().getTextContent())).toBe(text)
  expect(
    readEditorStateValue(editor, () =>
      $nodesOfType(WorkflowVariableBlockNode).map((node) => ({
        path: node.getVariables(),
        map: node.getWorkflowNodesMap(),
        variables: node.getAvailableVariables(),
        type: node.getVarType(),
      })),
    ),
  ).toEqual([
    { path: ['node-1', 'output'], map: workflowNodesMap, variables, type: getVarType },
    { path: ['env', 'key'], map: workflowNodesMap, variables, type: getVarType },
  ])
  expect(onInsert).toHaveBeenCalledTimes(2)
  setEditorRootText(editor, 'ordinary text', (value) => new CustomTextNode(value))
  await waitFor(() => expect(getNodeCount(editor, WorkflowVariableBlockNode)).toBe(0))
  expect(onInsert).toHaveBeenCalledTimes(2)
})

it('uses updated callbacks and node metadata for subsequent replacements and unregisters on unmount', async () => {
  const first = vi.fn()
  const latest = vi.fn()
  let update: (value: boolean) => void
  let show: (value: boolean) => void
  const renamedMap = {
    ...workflowNodesMap,
    'node-1': { ...workflowNodesMap['node-1']!, title: 'Renamed' },
  }
  function Fixture() {
    const [updated, setUpdated] = useState(false)
    const [visible, setVisible] = useState(true)
    update = setUpdated
    show = setVisible
    return visible ? (
      <WorkflowVariableBlockReplacementBlock
        workflowNodesMap={updated ? renamedMap : workflowNodesMap}
        onInsert={updated ? latest : first}
      />
    ) : null
  }
  const { getEditor } = renderLexicalEditor({
    namespace: 'workflow-replacement-updates',
    nodes: [CustomTextNode, WorkflowVariableBlockNode],
    children: <Fixture />,
  })
  const editor = await waitForEditorReady(getEditor)
  act(() => update(true))
  setEditorRootText(editor, '{{#node-1.output#}}', (value) => new CustomTextNode(value))
  await waitFor(() => expect(getNodeCount(editor, WorkflowVariableBlockNode)).toBe(1))
  expect(
    readEditorStateValue(editor, () =>
      $nodesOfType(WorkflowVariableBlockNode)[0]!.getWorkflowNodesMap(),
    ),
  ).toEqual(renamedMap)
  expect(latest).toHaveBeenCalledOnce()
  expect(first).not.toHaveBeenCalled()
  act(() => show(false))
  setEditorRootText(editor, '{{#node-1.output#}}', (value) => new CustomTextNode(value))
  await waitFor(() => expect(getNodeCount(editor, WorkflowVariableBlockNode)).toBe(0))
  expect(latest).toHaveBeenCalledOnce()
})
