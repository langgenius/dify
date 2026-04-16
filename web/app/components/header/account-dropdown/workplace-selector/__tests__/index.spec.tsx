import type { ReactNode } from 'react'
import type { IWorkspace } from '@/models/common'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useWorkspacesContext } from '@/context/workspace-context'
import { switchWorkspace } from '@/service/common'
import WorkplaceSelector from '../index'

const toastMocks = vi.hoisted(() => ({
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

vi.mock('@/context/workspace-context', () => ({
  useWorkspacesContext: vi.fn(),
}))

vi.mock('@/service/common', () => ({
  switchWorkspace: vi.fn(),
}))

vi.mock('@/app/components/base/ui/toast', () => ({
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

vi.mock('@/app/components/base/ui/select', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/components/base/ui/select')>()

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
  const mockWorkspaces: IWorkspace[] = [
    { id: '1', name: 'Workspace 1', current: true, plan: 'professional', status: 'normal', created_at: Date.now() },
    { id: '2', name: 'Workspace 2', current: false, plan: 'sandbox', status: 'normal', created_at: Date.now() },
  ]

  const { mockNotify } = toastMocks
  const mockAssign = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    selectMocks.state = selectMocks.reset()
    vi.mocked(useWorkspacesContext).mockReturnValue({
      workspaces: mockWorkspaces,
    })
    vi.stubGlobal('location', { ...window.location, assign: mockAssign })
  })

  const renderComponent = () => render(<WorkplaceSelector />)

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
      vi.mocked(switchWorkspace).mockResolvedValue({
        result: 'success',
        new_tenant: mockWorkspaces[1]!,
      })

      renderComponent()
      fireEvent.click(screen.getByTestId('workspace-option-2'))

      await waitFor(() => expect(switchWorkspace).toHaveBeenCalledWith({
        url: '/workspaces/switch',
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

      expect(switchWorkspace).not.toHaveBeenCalled()
    })

    it('should handle switching error correctly', async () => {
      vi.mocked(switchWorkspace).mockRejectedValue(new Error('Failed'))

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
      vi.mocked(useWorkspacesContext).mockReturnValue({
        workspaces: [
          { id: '1', name: 'Workspace 1', current: false, plan: 'professional', status: 'normal', created_at: Date.now() },
        ],
      })

      expect(() => renderComponent()).not.toThrow()
    })

    it('should not crash when workspace name is empty string', () => {
      vi.mocked(useWorkspacesContext).mockReturnValue({
        workspaces: [
          { id: '1', name: '', current: true, plan: 'sandbox', status: 'normal', created_at: Date.now() },
        ],
      })

      expect(() => renderComponent()).not.toThrow()
    })
  })
})
