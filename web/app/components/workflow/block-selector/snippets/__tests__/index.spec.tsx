import type { ReactElement } from 'react'
import type { Edge, Node } from '../../../types'
import type { SnippetListItem, SnippetListResponse } from '@/types/snippet'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { useEdges, useNodes } from 'reactflow'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createEdge, createNode } from '../../../__tests__/fixtures'
import { renderWorkflowFlowComponent } from '../../../__tests__/workflow-test-env'
import Snippets from '../index'

const requests = vi.hoisted(() => ({ list: vi.fn(), increment: vi.fn() }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.customizedSnippets.get': requests.list,
      'workspaces.current.customizedSnippets.bySnippetId.useCount.increment.post':
        requests.increment,
    }),
  }
})
const snippet: SnippetListItem = {
  id: 'snippet-1',
  name: 'Customer Review',
  description: 'Snippet description',
  type: 'group',
  is_published: true,
  version: 1,
  use_count: 3,
  tags: [],
  created_at: 1,
  created_by: 'user-1',
  updated_at: 2,
  updated_by: 'user-1',
}
const page = (data = [snippet]): SnippetListResponse => ({
  data,
  page: 1,
  limit: 30,
  total: data.length,
  has_more: false,
})
function Canvas() {
  const nodes = useNodes()
  const edges = useEdges()
  return <output aria-label="Canvas graph">{JSON.stringify({ nodes, edges })}</output>
}
function renderSnippets(ui: ReactElement = <Snippets searchText="" />) {
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(
    consoleQuery.tags.get.queryKey({ input: { query: { type: 'snippet' } } }),
    [{ id: 'tag-1', name: 'Sales', type: 'snippet', binding_count: '' }],
  )
  queryClient.setQueryData(
    consoleQuery.snippets.bySnippetId.workflows.publish.get.queryKey({
      input: { params: { snippet_id: 'snippet-1' } },
    }),
    {
      id: 'published-1',
      version: '1',
      hash: 'published-hash',
      created_at: 1,
      updated_at: 2,
      marked_name: '',
      marked_comment: '',
      features: {},
      conversation_variables: [],
      environment_variables: [],
      rag_pipeline_variables: [],
      tool_published: false,
      graph: {
        nodes: [
          createNode({ id: 'first', data: { title: 'Review input' } }),
          createNode({ id: 'second', data: { title: 'Review result' } }),
        ],
        edges: [createEdge({ source: 'first', target: 'second' })],
      },
    },
  )
  return {
    queryClient,
    ...renderWorkflowFlowComponent(
      <>
        {ui}
        <Canvas />
      </>,
      {
        queryClient,
        nodes: [
          createNode({
            id: 'existing',
            selected: true,
            data: { title: 'Existing node', selected: true },
          }),
        ],
      },
    ),
  }
}
beforeEach(() => {
  requests.list.mockReset().mockResolvedValue(page())
  requests.increment.mockReset().mockResolvedValue({ use_count: 4 })
})

it('shows loading until the snippet query resolves', async () => {
  const pending = createDeferred<ReturnType<typeof page>>()
  requests.list.mockReturnValue(pending.promise)
  renderSnippets()
  expect(screen.getByRole('status', { name: 'common.loading' })).toBeInTheDocument()
  await act(async () => pending.resolve(page()))
  expect(await screen.findByRole('button', { name: /Customer Review/ })).toBeInTheDocument()
  expect(screen.queryByRole('status', { name: 'common.loading' })).not.toBeInTheDocument()
})
it('shows the empty state after an empty response', async () => {
  requests.list.mockResolvedValue(page([]))
  renderSnippets()
  expect(await screen.findByText('workflow.tabs.noSnippetsFound')).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'workflow.tabs.createSnippet' }),
  ).not.toBeInTheDocument()
})
it('keeps cached rows visible while the current search refreshes', async () => {
  const pending = createDeferred<ReturnType<typeof page>>()
  const { queryClient } = renderSnippets(<Snippets searchText="customer" />)
  await screen.findByRole('button', { name: /Customer Review/ })
  requests.list.mockReturnValue(pending.promise)
  act(() => {
    void queryClient.invalidateQueries({ queryKey: ['snippets', 'list'] })
  })
  await waitFor(() => expect(queryClient.isFetching()).toBe(1))
  expect(screen.getByRole('button', { name: /Customer Review/ })).toBeInTheDocument()
  expect(screen.queryByRole('status', { name: 'common.loading' })).not.toBeInTheDocument()
  expect(requests.list).toHaveBeenLastCalledWith({
    query: { page: 1, limit: 30, keyword: 'customer', is_published: true },
  })
  await act(async () => pending.resolve(page([{ ...snippet, name: 'Updated review' }])))
  expect(await screen.findByRole('button', { name: /Updated review/ })).toBeInTheDocument()
})
it('filters the displayed snippets using the selected tag', async () => {
  const user = userEvent.setup()
  requests.list.mockResolvedValueOnce(page()).mockResolvedValue(page([]))
  renderSnippets()
  await screen.findByRole('button', { name: /Customer Review/ })
  await user.click(screen.getByRole('button', { name: 'common.tag.placeholder' }))
  await user.click(await screen.findByRole('checkbox', { name: 'Sales' }))
  expect(await screen.findByText('workflow.tabs.noSnippetsFound')).toBeInTheDocument()
  expect(requests.list).toHaveBeenLastCalledWith({
    query: { page: 1, limit: 30, tag_ids: ['tag-1'], is_published: true },
  })
  expect(screen.queryByRole('button', { name: /Customer Review/ })).not.toBeInTheDocument()
})
it('updates and clears the embedded search through its controlled caller', async () => {
  const user = userEvent.setup()
  function Caller() {
    const [searchText, setSearchText] = useState('')
    return <Snippets searchText={searchText} onSearchTextChange={setSearchText} />
  }
  renderSnippets(<Caller />)
  const input = screen.getByRole('searchbox', { name: 'workflow.tabs.searchSnippets' })
  await user.type(input, 'review')
  expect(input).toHaveValue('review')
  await waitFor(() =>
    expect(requests.list).toHaveBeenLastCalledWith({
      query: { page: 1, limit: 30, keyword: 'review', is_published: true },
    }),
  )
  await user.click(screen.getByRole('button', { name: 'workflow.tabs.clearSnippetSearch' }))
  expect(input).toHaveValue('')
  expect(
    screen.queryByRole('button', { name: 'workflow.tabs.clearSnippetSearch' }),
  ).not.toBeInTheDocument()
})
it('inserts the clicked snippet graph into the real canvas', async () => {
  const user = userEvent.setup()
  renderSnippets()
  await user.click(await screen.findByRole('button', { name: /Customer Review/ }))
  const graph = (): { nodes: Node[]; edges: Edge[] } =>
    JSON.parse(screen.getByLabelText('Canvas graph').textContent!)
  await waitFor(() => expect(graph().nodes).toHaveLength(3))
  const { nodes, edges } = graph()
  const first = nodes.find((node) => node.data.title === 'Review input')!
  const second = nodes.find((node) => node.data.title === 'Review result')!
  expect(nodes[0]).toMatchObject({ id: 'existing', selected: false })
  expect(first).toMatchObject({ selected: true })
  expect(second).toMatchObject({ selected: true })
  expect(new Set(nodes.map((node) => node.id)).size).toBe(3)
  expect(edges).toEqual([expect.objectContaining({ source: first.id, target: second.id })])
  expect(requests.increment).toHaveBeenCalledWith({ params: { snippet_id: 'snippet-1' } })
})
it('opens the keyboard preview for a snippet without a description', async () => {
  const user = userEvent.setup()
  requests.list.mockResolvedValue(page([{ ...snippet, name: 'No Description', description: '' }]))
  renderSnippets()
  const row = await screen.findByRole('button', { name: 'No Description' })
  act(() => row.focus())
  await user.keyboard('{Tab}{Shift>}{Tab}{/Shift}')
  expect(row).toHaveFocus()
  expect(await screen.findByText('snippet.unknownUser')).toBeInTheDocument()
})
