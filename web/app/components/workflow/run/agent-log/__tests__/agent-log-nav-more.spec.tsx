import type { AgentLogItemWithChildren } from '@/types/workflow'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AgentLogNavMore from '../agent-log-nav-more'

vi.mock('@/app/components/base/ui/dropdown-menu', async () => {
  const React = await import('react')
  const DropdownMenuContext = React.createContext<{ open: boolean, setOpen: (open: boolean) => void } | null>(null)

  const useDropdownMenuContext = () => {
    const context = React.use(DropdownMenuContext)
    if (!context)
      throw new Error('DropdownMenu components must be wrapped in DropdownMenu')
    return context
  }

  return {
    DropdownMenu: ({ children, open, onOpenChange }: { children: React.ReactNode, open: boolean, onOpenChange?: (open: boolean) => void }) => (
      <DropdownMenuContext value={{ open, setOpen: onOpenChange ?? vi.fn() }}>
        <div>{children}</div>
      </DropdownMenuContext>
    ),
    DropdownMenuTrigger: ({ children, render }: { children: React.ReactNode, render?: React.ReactElement }) => {
      const { open, setOpen } = useDropdownMenuContext()

      if (render)
        return React.cloneElement(render, { onClick: () => setOpen(!open) } as Record<string, unknown>, children)

      return <button type="button" onClick={() => setOpen(!open)}>{children}</button>
    },
    DropdownMenuContent: ({ children }: { children: React.ReactNode }) => {
      const { open } = useDropdownMenuContext()
      return open ? <div>{children}</div> : null
    },
    DropdownMenuItem: ({ children, onClick }: { children: React.ReactNode, onClick?: React.MouseEventHandler<HTMLButtonElement> }) => {
      const { setOpen } = useDropdownMenuContext()
      return (
        <button
          type="button"
          onClick={(event) => {
            onClick?.(event)
            setOpen(false)
          }}
        >
          {children}
        </button>
      )
    },
  }
})

const createLogItem = (overrides: Partial<AgentLogItemWithChildren> = {}): AgentLogItemWithChildren => ({
  message_id: 'message-1',
  label: 'Planner',
  children: [],
  status: 'succeeded',
  node_execution_id: 'exec-1',
  node_id: 'node-1',
  data: {},
  ...overrides,
})

describe('AgentLogNavMore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nested options in the real menu and routes selection clicks', async () => {
    const user = userEvent.setup()
    const onShowAgentOrToolLog = vi.fn()
    const option = createLogItem({ message_id: 'mid', label: 'Intermediate Tool' })

    render(
      <AgentLogNavMore
        options={[option]}
        onShowAgentOrToolLog={onShowAgentOrToolLog}
      />,
    )

    await user.click(screen.getByRole('button'))
    await user.click(screen.getByText('Intermediate Tool'))

    expect(onShowAgentOrToolLog).toHaveBeenCalledWith(option)
  })
})
