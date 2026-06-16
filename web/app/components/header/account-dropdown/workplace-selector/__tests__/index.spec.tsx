import type { ReactNode } from 'react'
import type { IWorkspace } from '@/models/common'
import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createTestQueryClient } from '@/__tests__/utils/mock-system-features'
import { consoleQuery } from '@/service/client'
import WorkplaceSelector from '../index'

const toastMocks = vi.hoisted(() => ({
  mockSwitchWorkspace: vi.fn(),
  mockNotify: vi.fn(),
}))

type MockSelectState = {
  value: string
  onValueChange: (value: string | null) => void
}

const selectMocks = vi.hoisted(() => ({
  state: {
    value: '',
    onValueChange: () => {},
  } as MockSelectState,
  reset: (): MockSelectState => ({
    value: '',
    onValueChange: () => {},
  }),
}))

vi.mock('@/service/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/client')>()
  const workspacesQueryKey = ['console', 'workspaces', 'get'] as const
  const consoleQuery = new Proxy(actual.consoleQuery, {
    get(target, prop, receiver) {
      if (prop === 'workspaces') {
        return {
          get: {
            queryKey: () => workspacesQueryKey,
            queryOptions: () => ({
              queryKey: workspacesQueryKey,
              queryFn: () => new Promise(() => {}),
            }),
          },
          switch: {
            post: {
              mutationOptions: () => ({
                mutationFn: (variables: unknown) => toastMocks.mockSwitchWorkspace(variables),
              }),
            },
          },
        }
      }

      return Reflect.get(target, prop, receiver)
    },
  })

  return {
    ...actual,
    consoleQuery,
  }
})

vi.mock('@langgenius/dify-ui/toast', () => ({
  default: {
    notify: (args: unknown) => toastMocks.mockNotify(args),
  },
  toast: {
    success: (message: string) => toastMocks.mockNotify({ type: 'success', message }),
    error: (message: string) => toastMocks.mockNotify({ type: 'error', message }),
    warning: (message: string) => toastMocks.mockNotify({ type: 'warning', message }),
    info: (message: string) => toastMocks.mockNotify({ type: 'info', message }),
  },
}))

vi.mock('@langgenius/dify-ui/select', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@langgenius/dify-ui/select')>()

  return {
    ...actual,
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value: string
      onValueChange: (value: string | null) => void
      children: ReactNode
    }) => {
      selectMocks.state = { value, onValueChange }
      return <div data-testid="workplace-selector-root">{children}</div>
    },
    SelectTrigger: ({ children }: { children: ReactNode }) => (
      <button data-testid="workplace-selector-trigger" type="button">
        {children}
      </button>
    ),
    SelectContent: ({ children }: { children: ReactNode }) => (
      <div data-testid="workplace-selector-content">{children}</div>
    ),
    SelectGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectLabel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectGroupLabel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectItem: ({
      children,
      value,
    }: {
      children: ReactNode
      value: string
    }) => (
      <button
        data-testid={`workspace-option-${value}`}
        type="button"
        onClick={() => selectMocks.state.onValueChange(value)}
      >
        {children}
      </button>
    ),
    SelectItemText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  }
})

describe('WorkplaceSelector', () => {
  const defaultWorkspaces: IWorkspace[] = [
    { id: '1', name: 'Workspace 1', current: true, plan: 'professional', status: 'normal', created_at: Date.now() },
    { id: '2', name: 'Workspace 2', current: false, plan: 'sandbox', status: 'normal', created_at: Date.now() },
  ]

  const { mockNotify, mockSwitchWorkspace } = toastMocks
  const mockAssign = vi.fn()
  let mockWorkspaces: IWorkspace[] = []

  beforeEach(() => {
    vi.clearAllMocks()
    selectMocks.state = selectMocks.reset()
    mockWorkspaces = defaultWorkspaces
    vi.stubGlobal('location', { ...window.location, assign: mockAssign })
  })

  const renderComponent = () => {
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(consoleQuery.workspaces.get.queryKey(), { workspaces: mockWorkspaces })
    return render(
      <QueryClientProvider client={queryClient}>
        <WorkplaceSelector />
      </QueryClientProvider>,
    )
  }

  describe('Rendering', () => {
    it('should render current workspace and available workspace options', () => {
      renderComponent()

      expect(screen.getByTestId('workplace-selector-trigger'))!.toHaveTextContent('Workspace 1')
      expect(screen.getByTestId('workspace-option-1'))!.toBeInTheDocument()
      expect(screen.getByTestId('workspace-option-2'))!.toBeInTheDocument()
      expect(screen.getByTestId('workspace-option-1'))!.toHaveTextContent('Workspace 1')
      expect(screen.getByTestId('workspace-option-2'))!.toHaveTextContent('Workspace 2')
    })
  })

  describe('Workspace Switching', () => {
    it('should switch workspace successfully', async () => {
      mockSwitchWorkspace.mockResolvedValue({
        result: 'success',
        new_tenant: mockWorkspaces[1]!,
      })

      renderComponent()
      fireEvent.click(screen.getByTestId('workspace-option-2'))

      await waitFor(() => expect(mockSwitchWorkspace).toHaveBeenCalledWith({
        body: { tenant_id: '2' },
      }))

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'success',
          message: 'common.actionMsg.modifiedSuccessfully',
        })
        expect(mockAssign).toHaveBeenCalled()
      })
    })

    it('should not switch to the already current workspace', () => {
      renderComponent()
      fireEvent.click(screen.getByTestId('workspace-option-1'))

      expect(mockSwitchWorkspace).not.toHaveBeenCalled()
    })

    it('should handle switching error correctly', async () => {
      mockSwitchWorkspace.mockRejectedValue(new Error('Failed'))

      renderComponent()
      fireEvent.click(screen.getByTestId('workspace-option-2'))

      await waitFor(() => {
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'error',
          message: 'common.actionMsg.modifiedUnsuccessfully',
        })
      })
    })
  })

  describe('Edge Cases', () => {
    it('should not crash when no workspace has current value', () => {
      mockWorkspaces = [
        { id: '1', name: 'Workspace 1', current: false, plan: 'professional', status: 'normal', created_at: Date.now() },
      ]

      expect(() => renderComponent()).not.toThrow()
    })

    it('should not crash when workspace name is empty string', () => {
      mockWorkspaces = [
        { id: '1', name: '', current: true, plan: 'sandbox', status: 'normal', created_at: Date.now() },
      ]

      expect(() => renderComponent()).not.toThrow()
    })
  })
})
