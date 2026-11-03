import type { ReactNode } from 'react'
import type { HumanInputV2NodeType } from '../../nodes/human-input-v2/types'
import type { Node } from '../../types'
import { act } from '@testing-library/react'
import { createElement, Fragment } from 'react'
import { useStoreApi } from 'reactflow'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper, seedAppDslVersion } from '@/test/console/query-data'
import { CanvasNodesCatalogProbe } from '../../__tests__/canvas-nodes-catalog-probe'
import { createNode } from '../../__tests__/fixtures'
import { renderWorkflowCanvasHook } from '../../__tests__/workflow-test-env'
import HumanInputV2Default from '../../nodes/human-input-v2/default'
import HumanInputDefault from '../../nodes/human-input/default'
import { BlockEnum } from '../../types'
import { writeWorkflowClipboard } from '../../utils/clipboard'
import { useNodesInteractions } from '../use-nodes-interactions'

vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  ENABLE_HITL_IM: true,
}))

const legacyNode = () =>
  createNode({
    id: 'legacy-human-input',
    data: {
      ...HumanInputDefault.defaultValue,
      type: BlockEnum.HumanInput,
      title: 'Legacy approval',
    },
  })
const v2Node = () =>
  createNode({
    id: 'copied-v2',
    data: { ...HumanInputV2Default.defaultValue, type: BlockEnum.HumanInput, title: 'Approval' },
  })
const Catalog = ({ children }: { children: ReactNode }) =>
  createElement(Fragment, null, createElement(CanvasNodesCatalogProbe), children)
function setup(nodes: Node[]) {
  const { queryClient } = createConsoleQueryWrapper()
  seedModelProviderQueries(queryClient)
  seedAppDslVersion(queryClient, '1.0.0')
  return renderWorkflowCanvasHook(
    () => ({
      ...useNodesInteractions(),
      canvas: useStoreApi(),
    }),
    {
      nodes,
      edges: [],
      queryClient,
      historyStore: { nodes, edges: [] },
      wrapper: Catalog,
      hooksStoreProps: { doSyncWorkflowDraft: async () => null },
    },
  )
}

beforeEach(async () => {
  await navigator.clipboard.writeText('')
  vi.useFakeTimers()
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

it.each([undefined, BlockEnum.Iteration, BlockEnum.Loop])(
  'creates Human Input v2 with persisted type in container %s',
  (containerType) => {
    const parentId = containerType ? 'container-node' : undefined
    const nodes = [
      createNode({
        id: 'node-1',
        parentId,
        width: 100,
        data: { type: BlockEnum.Code, title: 'Code', desc: '' },
      }),
    ]
    if (containerType)
      nodes.unshift(
        createNode({
          id: parentId,
          width: 500,
          height: 400,
          data: { type: containerType, title: 'Container', desc: '' },
        }),
      )
    const { result } = setup(nodes)
    act(() =>
      result.current.handleNodeAdd({ nodeType: BlockEnum.HumanInputV2 }, { prevNodeId: 'node-1' }),
    )

    const node = result.current.canvas
      .getState()
      .getNodes()
      .find((node) => node.data.version === '2')
    expect(node?.data).toMatchObject({
      type: BlockEnum.HumanInput,
      version: '2',
      recipients_spec: [],
      timeout: 36,
      timeout_unit: 'hour',
    })
    expect(node?.data).not.toHaveProperty('delivery_methods')
    expect(node?.data._connectedSourceHandleIds).toEqual([])
    expect(node?.parentId).toBe(parentId)
    if (containerType)
      expect(node?.data).toMatchObject({
        isInIteration: containerType === BlockEnum.Iteration,
        isInLoop: containerType === BlockEnum.Loop,
        [containerType === BlockEnum.Iteration ? 'iteration_id' : 'loop_id']: parentId,
      })
  },
)

it.each(['add', 'paste', 'duplicate'] as const)(
  'preserves the canvas when legacy approval blocks %s',
  async (command) => {
    const nodes = [legacyNode(), createNode({ id: 'node-1' })]
    const { result } = setup(nodes)
    const before = result.current.canvas.getState().getNodes()
    if (command === 'paste') await writeWorkflowClipboard({ nodes: [v2Node()], edges: [] }, '1.0.0')
    await act(async () => {
      if (command === 'add')
        result.current.handleNodeAdd({ nodeType: BlockEnum.HumanInputV2 }, { prevNodeId: 'node-1' })
      else if (command === 'paste') await result.current.handleNodesPaste()
      else result.current.handleNodesDuplicate('legacy-human-input')
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(result.current.canvas.getState().getNodes()).toEqual(before)
    expect(result.current.canvas.getState().edges).toEqual([])
  },
)

it('pastes Human Input v2 without losing wire data and remaps copied dependencies', async () => {
  const copiedSourceNode = createNode({
    id: 'source-copy',
    data: {
      type: BlockEnum.Code,
      title: 'Email source',
      desc: '',
      variables: [],
      code_language: 'python3',
      code: '',
      outputs: { email: { type: 'string', children: null } },
    },
  })
  const copiedNode = createNode({
    id: 'human-input-v2-copy',
    data: {
      type: BlockEnum.HumanInput,
      version: '2',
      title: 'Review request',
      desc: '',
      recipients_spec: [
        { type: 'initiator' },
        { type: 'dynamic_email', selector: ['source-copy', 'email'] },
        { type: 'onetime_email', email: 'owner@example.com' },
      ],
      message_template: {
        subject: 'Review {{#source-copy.email#}}',
        body: 'Body {{#source-copy.email#}}',
      },
      debug_mode: { enabled: true, channels: ['email', 'slack'] },
      form_content: '{{#source-copy.email#}}',
      inputs: [],
      user_actions: [],
      timeout: 36,
      timeout_unit: 'hour',
    },
  })

  const { result } = setup([createNode({ id: 'existing-node' })])
  await writeWorkflowClipboard({ nodes: [copiedSourceNode, copiedNode], edges: [] }, '1.0.0')
  await act(async () => result.current.handleNodesPaste())

  const pastedNodes = result.current.canvas.getState().getNodes()
  expect(pastedNodes).toHaveLength(3)
  const pasted = pastedNodes.find((node) => node.data.version === '2')
  const pastedData = pasted?.data as HumanInputV2NodeType
  const copiedData = copiedNode.data as HumanInputV2NodeType
  const pastedSource = pastedNodes.find(
    (node) => node.data.type === BlockEnum.Code && node.id !== 'existing-node',
  )
  expect(pastedSource?.id).toBeDefined()
  expect(pastedSource?.id).not.toBe('source-copy')
  expect(pastedData.type).toBe(BlockEnum.HumanInput)
  expect(pastedData.recipients_spec).toEqual([
    { type: 'initiator' },
    { type: 'dynamic_email', selector: [pastedSource?.id, 'email'] },
    { type: 'onetime_email', email: 'owner@example.com' },
  ])
  expect(pastedData.message_template).toEqual({
    subject: `Review {{#${pastedSource?.id}.email#}}`,
    body: `Body {{#${pastedSource?.id}.email#}}`,
  })
  expect(pastedData.form_content).toBe(`{{#${pastedSource?.id}.email#}}`)
  expect(pastedData.debug_mode).toEqual(copiedData.debug_mode)
})
