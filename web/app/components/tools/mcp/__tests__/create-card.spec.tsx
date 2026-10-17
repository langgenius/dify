import type { ToolProviderApiEntityResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vite-plus/test'
import {
  getStepByStepTourTargetSelector,
  STEP_BY_STEP_TOUR_TARGETS,
} from '@/app/components/step-by-step-tour/target-registry'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { render } from '@/test/console/render'
import NewMCPCard, { NewMCPButton } from '../create-card'

// Track the mock functions
const mockCreateMCP = vi.fn().mockResolvedValue({
  id: 'new-mcp-id',
  name: 'New MCP',
  author: 'tester',
  label: { en_US: 'New MCP' },
  description: { en_US: '' },
  icon: '',
  type: 'mcp',
} satisfies ToolProviderApiEntityResponse)

// Mock the service
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.toolProvider.mcp.post': (input) => mockCreateMCP(input),
    }),
  }
})

// Mock the MCP Modal
type MockMCPModalProps = {
  show: boolean
  onConfirm: (info: { name: string; server_url: string }) => void
  onHide: () => void
}

vi.mock('../modal', () => ({
  default: ({ show, onConfirm, onHide }: MockMCPModalProps) => {
    if (!show) return null
    return (
      <div data-testid="mcp-modal">
        <span>tools.mcp.modal.title</span>
        <button
          data-testid="confirm-btn"
          onClick={() => onConfirm({ name: 'Test MCP', server_url: 'https://test.com' })}
        >
          Confirm
        </button>
        <button data-testid="close-btn" onClick={onHide}>
          Close
        </button>
      </div>
    )
  },
}))

const mockConsoleState = vi.hoisted(() => ({
  workspacePermissionKeys: ['mcp.manage'] as string[],
}))

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')

  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: mockConsoleState.workspacePermissionKeys,
  }))
})

// Mock the plugins service
vi.mock('@/service/use-plugins', () => ({
  useInstalledPluginList: () => ({
    data: { pages: [] },
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    isLoading: false,
    isSuccess: true,
  }),
}))

// Mock common service
vi.mock('@/service/common', () => ({
  uploadRemoteFileInfo: vi.fn().mockResolvedValue({ url: 'https://example.com/icon.png' }),
}))

beforeEach(() => {
  mockConsoleState.workspacePermissionKeys = ['mcp.manage']
})

it.each([NewMCPCard, NewMCPButton])(
  'creates the selected provider through either entry point',
  async (Entry) => {
    const user = userEvent.setup()
    const handleCreate = vi.fn()
    render(<Entry handleCreate={handleCreate} />, { wrapper: createConsoleQueryWrapper().wrapper })
    await user.click(screen.getByRole('button', { name: 'tools.mcp.create.cardTitle' }))
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() =>
      expect(handleCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'new-mcp-id',
          name: 'New MCP',
          tools: [],
          is_team_authorization: false,
        }),
      ),
    )
    expect(mockCreateMCP).toHaveBeenCalledExactlyOnceWith({
      body: { name: 'Test MCP', server_url: 'https://test.com' },
    })
  },
)

it('closes creation without creating a provider', async () => {
  const user = userEvent.setup()
  const handleCreate = vi.fn()
  render(<NewMCPCard handleCreate={handleCreate} />, {
    wrapper: createConsoleQueryWrapper().wrapper,
  })
  await user.click(screen.getByRole('button', { name: 'tools.mcp.create.cardTitle' }))
  await user.click(screen.getByRole('button', { name: 'Close' }))
  expect(screen.queryByTestId('mcp-modal')).not.toBeInTheDocument()
  expect(mockCreateMCP).not.toHaveBeenCalled()
  expect(handleCreate).not.toHaveBeenCalled()
})

it.each([NewMCPCard, NewMCPButton])('hides creation without mcp.manage', (Entry) => {
  mockConsoleState.workspacePermissionKeys = []
  render(<Entry handleCreate={vi.fn()} />, { wrapper: createConsoleQueryWrapper().wrapper })
  expect(
    screen.queryByRole('button', { name: 'tools.mcp.create.cardTitle' }),
  ).not.toBeInTheDocument()
})

it('anchors the tour to the toolbar action and links the card to MCP documentation', () => {
  render(
    <>
      <NewMCPCard handleCreate={vi.fn()} />
      <NewMCPButton handleCreate={vi.fn()} />
    </>,
    { wrapper: createConsoleQueryWrapper().wrapper },
  )
  const selector = getStepByStepTourTargetSelector(STEP_BY_STEP_TOUR_TARGETS.integrationMcpAdd)
  expect(document.querySelectorAll(selector)).toHaveLength(1)
  expect(document.querySelector(selector)).toHaveTextContent('tools.mcp.create.cardTitle')
  expect(screen.getByRole('link', { name: 'tools.mcp.create.cardLink' })).toHaveAttribute(
    'href',
    expect.stringContaining('/workspace/tools#mcp'),
  )
})
