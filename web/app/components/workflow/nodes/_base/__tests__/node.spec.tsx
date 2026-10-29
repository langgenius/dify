import type { Node } from '@/app/components/workflow/types'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useNodes } from 'reactflow'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { ITERATION_PADDING, LOOP_PADDING } from '@/app/components/workflow/constants'
import codeDefault from '@/app/components/workflow/nodes/code/default'
import iterationDefault from '@/app/components/workflow/nodes/iteration/default'
import loopDefault from '@/app/components/workflow/nodes/loop/default'
import toolDefault from '@/app/components/workflow/nodes/tool/default'
import { BlockEnum, NodeRunningStatus } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper, seedAppDslVersion } from '@/test/console/query-data'
import { createToolProviderFixture } from '@/test/console/tool-provider-fixture'
import { seedToolProviders } from '@/test/console/tool-providers'
import BaseNode from '../node'

const view = (node: Node) => (
  <BaseNode id={node.id} data={node.data}>
    <div>Node content</div>
  </BaseNode>
)
function renderNode(node: Node, parents: Node[] = []) {
  const { queryClient } = createConsoleQueryWrapper({
    systemFeatures: { enable_collaboration_mode: false, enable_marketplace: false },
    workspacePermissionKeys: ['plugin.install'],
  })
  seedAppDslVersion(queryClient)
  seedModelProviderQueries(queryClient)
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  queryClient.setQueryData(consoleQuery.workspaces.current.agentProviders.get.queryKey(), [])
  queryClient.setQueryData(consoleQuery.workspaces.current.triggers.get.queryKey({ input: {} }), [])
  const result = renderWorkflowFlowComponent(
    <>
      {view(node)}
      <ContainerSize />
    </>,
    {
      queryClient,
      nodes: [...parents, node],
    },
  )
  return { ...result, queryClient }
}
function ContainerSize() {
  const parent = useNodes<Node['data']>().find((node) => node.id === 'parent')
  return (
    <output aria-label="Container size">
      {parent ? `${parent.data.width} × ${parent.data.height}` : ''}
    </output>
  )
}

afterEach(() => vi.unstubAllGlobals())

it('removes the missing-plugin lock when the catalog gains the tool and accepts a run request', async () => {
  const user = userEvent.setup()
  const node = createNode({
    id: 'tool',
    data: {
      ...toolDefault.defaultValue,
      type: BlockEnum.Tool,
      title: 'Search documents',
      desc: 'Search workspace knowledge',
      selected: true,
      provider_type: 'builtin',
      provider_id: 'search',
      provider_name: 'search',
      plugin_id: 'plugin-search',
      plugin_unique_identifier: 'plugin-search@1.0.0',
      tool_name: 'search',
      tool_label: 'Search',
    },
  })
  const { queryClient, store } = renderNode(node)
  expect(screen.getByRole('button', { name: 'plugin.installPlugin' })).toBeDisabled()
  act(() =>
    seedToolProviders(queryClient, {
      builtInTools: [
        createToolProviderFixture({
          id: 'search',
          name: 'search',
          plugin_id: 'plugin-search',
          plugin_unique_identifier: 'plugin-search@1.0.0',
        }),
      ],
    }),
  )
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'plugin.installPlugin' })).not.toBeInTheDocument(),
  )
  expect(screen.getByText('Search workspace knowledge')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'workflow.panel.runThisStep' }))
  expect(store.getState().pendingSingleRun).toEqual({ nodeId: 'tool', action: 'run' })
})

it('caps parallel iteration progress and explains parallel execution from the node header', async () => {
  const user = userEvent.setup()
  renderNode(
    createNode({
      id: 'iteration',
      data: {
        ...iterationDefault.defaultValue,
        type: BlockEnum.Iteration,
        is_parallel: true,
        _iterationLength: 3,
        _iterationIndex: 5,
        _runningStatus: NodeRunningStatus.Running,
      },
    }),
  )
  expect(screen.getByText('3/3')).toBeInTheDocument()
  expect(screen.getByText('workflow.nodes.iteration.parallelModeUpper')).toBeInTheDocument()
  await user.click(
    screen.getByRole('button', { name: 'workflow.nodes.iteration.parallelModeEnableTitle' }),
  )
  expect(await screen.findByRole('dialog')).toHaveTextContent(
    'workflow.nodes.iteration.parallelModeEnableDesc',
  )
})

it('changes the loop count from current progress to total iterations on completion', () => {
  const node = createNode({
    id: 'loop',
    data: {
      ...loopDefault.defaultValue,
      type: BlockEnum.Loop,
      title: 'Retry loop',
      _loopIndex: 3,
      _runningStatus: NodeRunningStatus.Running,
    },
  })
  const { rerender } = renderNode(node)
  expect(
    screen.getByText('workflowLogic.nodes.loop.currentLoopCount:{"count":3}'),
  ).toBeInTheDocument()
  rerender(view({ ...node, data: { ...node.data, _runningStatus: NodeRunningStatus.Succeeded } }))
  expect(
    screen.getByText('workflowLogic.nodes.loop.totalLoopCount:{"count":3}'),
  ).toBeInTheDocument()
  expect(screen.queryByText(/workflowLogic.nodes.loop.currentLoopCount/)).not.toBeInTheDocument()
})

function observeNodeResizes() {
  const observers = new Set<ResizeObserverStub>()
  class ResizeObserverStub implements ResizeObserver {
    readonly targets = new Set<Element>()
    readonly callback: ResizeObserverCallback
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback
      observers.add(this)
    }
    observe(target: Element) {
      this.targets.add(target)
    }
    unobserve(target: Element) {
      this.targets.delete(target)
    }
    disconnect() {
      this.targets.clear()
      observers.delete(this)
    }
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  return (content: HTMLElement) => {
    // Deliver a browser-boundary notification to the observed node containing this public slot.
    for (const observer of [...observers]) {
      for (const target of observer.targets) {
        if (!target.contains(content)) continue
        observer.callback(
          [
            {
              target,
              contentRect: target.getBoundingClientRect(),
              borderBoxSize: [],
              contentBoxSize: [],
              devicePixelContentBoxSize: [],
            },
          ],
          observer,
        )
      }
    }
  }
}

it.each([
  {
    type: BlockEnum.Iteration,
    selected: false,
    parentDefaults: iterationDefault.defaultValue,
    padding: ITERATION_PADDING,
    childFlags: { isInIteration: true },
  },
  {
    type: BlockEnum.Iteration,
    selected: true,
    parentDefaults: iterationDefault.defaultValue,
    padding: ITERATION_PADDING,
    childFlags: { isInIteration: true },
  },
  {
    type: BlockEnum.Loop,
    selected: true,
    parentDefaults: loopDefault.defaultValue,
    padding: LOOP_PADDING,
    childFlags: { isInLoop: true },
  },
])(
  'resizes a $type container only for a selected child ($selected)',
  ({ type, selected, parentDefaults, padding, childFlags }) => {
    const resize = observeNodeResizes()
    renderNode(
      createNode({
        id: 'child',
        parentId: 'parent',
        position: { x: 100, y: 90 },
        width: 60,
        height: 40,
        data: { ...codeDefault.defaultValue, ...childFlags, selected },
      }),
      [
        createNode({
          id: 'parent',
          width: 120,
          height: 80,
          data: { ...parentDefaults, type, width: 120, height: 80 },
        }),
      ],
    )
    expect(screen.getByRole('status', { name: 'Container size' })).toHaveTextContent('120 × 80')
    act(() => resize(screen.getByText('Node content')))
    expect(screen.getByRole('status', { name: 'Container size' })).toHaveTextContent(
      selected ? `${160 + padding.right} × ${130 + padding.bottom}` : '120 × 80',
    )
  },
)
