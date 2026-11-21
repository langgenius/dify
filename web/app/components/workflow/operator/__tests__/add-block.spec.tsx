import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CanvasNodesCatalogProbe } from '../../__tests__/canvas-nodes-catalog-probe'
import { createNode } from '../../__tests__/fixtures'
import { renderWorkflowFlowComponent } from '../../__tests__/workflow-test-env'
import { BlockEnum } from '../../types'
import AddBlock from '../add-block'

vi.mock('@/service/use-plugins', () => ({
  useFeaturedToolsRecommendations: () => ({ plugins: [], isLoading: false }),
  useFeaturedTriggersRecommendations: () => ({ plugins: [], isLoading: false }),
}))

vi.mock('@/service/use-triggers', () => ({
  useAllTriggerPlugins: () => ({ data: [] }),
  useInvalidateAllTriggerPlugins: () => vi.fn(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.tools.builtin.get': async () => [],
      'workspaces.current.tools.api.get': async () => [],
      'workspaces.current.tools.workflow.get': async () => [],
      'workspaces.current.tools.mcp.get': async () => [],
    }),
  }
})

vi.mock('@/app/components/plugins/marketplace/query', () => ({
  useMarketplacePlugins: () => ({ data: undefined }),
}))

const renderWithReactFlow = (nodes: Array<ReturnType<typeof createNode>> = [], readonly = false) =>
  renderWorkflowFlowComponent(
    <>
      <CanvasNodesCatalogProbe />
      <AddBlock />
    </>,
    {
      resource: { kind: 'app', appId: 'app-1', mode: 'advanced-chat' },
      nodes,
      edges: [],
      initialStoreState: { canvasReadOnly: readonly, contextMenuTarget: { type: 'panel' } },
    },
  )

describe('AddBlock', () => {
  it('opens the real selector and exposes its open state', async () => {
    const user = userEvent.setup()
    renderWithReactFlow()

    const trigger = screen.getByRole('button', { name: 'workflow.common.addBlock' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    await user.click(trigger)

    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('dialog', { name: 'workflow.common.addBlock' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'workflow.blocks.answer' })).toBeInTheDocument()
  })

  it('keeps the disabled trigger focusable without opening the selector', async () => {
    const user = userEvent.setup()
    renderWithReactFlow([], true)

    const trigger = screen.getByRole('button', { name: 'workflow.common.addBlock' })
    expect(trigger).toHaveAttribute('aria-disabled', 'true')

    trigger.focus()
    expect(trigger).toHaveFocus()
    await user.click(trigger)
    expect(
      screen.queryByRole('dialog', { name: 'workflow.common.addBlock' }),
    ).not.toBeInTheDocument()
  })

  it('closes the selector through the real trigger and cancels the pane menu', async () => {
    const user = userEvent.setup()
    const { store } = renderWithReactFlow()

    const trigger = screen.getByRole('button', { name: 'workflow.common.addBlock' })
    await user.click(trigger)
    await user.click(trigger)

    expect(
      screen.queryByRole('dialog', { name: 'workflow.common.addBlock' }),
    ).not.toBeInTheDocument()
    expect(store.getState().contextMenuTarget).toBeUndefined()
  })

  it('creates a candidate node after selecting a real block option', async () => {
    const user = userEvent.setup()
    const { store } = renderWithReactFlow([
      createNode({ id: 'node-1', position: { x: 0, y: 0 }, data: { type: BlockEnum.Answer } }),
      createNode({ id: 'node-2', position: { x: 80, y: 0 }, data: { type: BlockEnum.Answer } }),
    ])

    await user.click(screen.getByRole('button', { name: 'workflow.common.addBlock' }))
    await user.click(screen.getByRole('button', { name: 'workflow.blocks.answer' }))

    expect(store.getState()).toMatchObject({
      candidateNode: expect.objectContaining({
        id: expect.any(String),
        type: 'custom',
        data: expect.objectContaining({ type: BlockEnum.Answer, _isCandidate: true }),
      }),
    })
  })
})
