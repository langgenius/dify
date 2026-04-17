import type {
  ReactNode,
} from 'react'
import type { CommonNodeType } from '@/app/components/workflow/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import {
  useAvailableBlocks,
  useNodesInteractions,
} from '@/app/components/workflow/hooks'
import { BlockEnum } from '@/app/components/workflow/types'
import Operator from '../operator'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ns?: string }) => options?.ns ? `${options.ns}.${key}` : key,
  }),
}))

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
    DropdownMenu: ({ children, open, onOpenChange }: { children: ReactNode, open: boolean, onOpenChange?: (open: boolean) => void }) => (
      <DropdownMenuContext value={{ open, setOpen: onOpenChange ?? vi.fn() }}>
        <div>{children}</div>
      </DropdownMenuContext>
    ),
    DropdownMenuTrigger: ({ children, render }: { children: ReactNode, render?: ReactNode }) => {
      const { open, setOpen } = useDropdownMenuContext()
      if (render)
        return <div onClick={() => setOpen(!open)}>{children}</div>

      return <button type="button" onClick={() => setOpen(!open)}>{children}</button>
    },
    DropdownMenuContent: ({ children }: { children: ReactNode }) => {
      const { open } = useDropdownMenuContext()
      return open ? <div>{children}</div> : null
    },
  }
})

vi.mock('@/app/components/base/ui/button', () => ({
  Button: ({ children, className }: { children: ReactNode, className?: string }) => (
    <button type="button" className={className}>
      {children}
    </button>
  ),
}))

vi.mock('@/app/components/workflow/block-selector', () => ({
  default: ({ trigger, onSelect }: { trigger: ((open: boolean) => ReactNode) | ReactNode, onSelect: (type: BlockEnum) => void }) => (
    <div>
      {typeof trigger === 'function' ? trigger(false) : trigger}
      <button type="button" onClick={() => onSelect(BlockEnum.HttpRequest)}>select-http</button>
    </div>
  ),
}))

vi.mock('@/app/components/workflow/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/components/workflow/hooks')>()
  return {
    ...actual,
    useAvailableBlocks: vi.fn(),
    useNodesInteractions: vi.fn(),
  }
})

const mockUseAvailableBlocks = vi.mocked(useAvailableBlocks)
const mockUseNodesInteractions = vi.mocked(useNodesInteractions)

const mockHandleNodeChange = vi.fn()
const mockHandleNodeDelete = vi.fn()
const mockHandleNodeDisconnect = vi.fn()

const defaultNodeData = {
  type: BlockEnum.Code,
  title: 'Code Node',
} as CommonNodeType

const TestHarness = () => {
  const [open, setOpen] = useState(false)
  return (
    <Operator
      open={open}
      onOpenChange={setOpen}
      data={defaultNodeData}
      nodeId="node-1"
      sourceHandle="source"
    />
  )
}

describe('NextStep operator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAvailableBlocks.mockReturnValue({
      availablePrevBlocks: [BlockEnum.HttpRequest],
      availableNextBlocks: [BlockEnum.HttpRequest],
      getAvailableBlocks: vi.fn(),
    } as ReturnType<typeof useAvailableBlocks>)
    mockUseNodesInteractions.mockReturnValue({
      handleNodeChange: mockHandleNodeChange,
      handleNodeDelete: mockHandleNodeDelete,
      handleNodeDisconnect: mockHandleNodeDisconnect,
    } as unknown as ReturnType<typeof useNodesInteractions>)
  })

  it('opens the menu and keeps the change action available', async () => {
    const user = userEvent.setup()
    render(<TestHarness />)

    await user.click(screen.getAllByRole('button')[0]!)

    expect(screen.getByText('workflow.panel.change')).toBeInTheDocument()
    expect(screen.getByText('workflow.common.disconnect')).toBeInTheDocument()
    expect(screen.getByText('common.operation.delete')).toBeInTheDocument()
  })

  it('changes the next-step block through the nested selector trigger', async () => {
    const user = userEvent.setup()
    render(<TestHarness />)

    await user.click(screen.getAllByRole('button')[0]!)
    await user.click(screen.getByText('select-http'))

    expect(mockHandleNodeChange).toHaveBeenCalledWith('node-1', BlockEnum.HttpRequest, 'source', undefined)
  })

  it('disconnects and deletes the next step from the menu', async () => {
    const user = userEvent.setup()
    render(<TestHarness />)

    await user.click(screen.getAllByRole('button')[0]!)
    await user.click(screen.getByText('workflow.common.disconnect'))
    expect(mockHandleNodeDisconnect).toHaveBeenCalledWith('node-1')
    expect(screen.queryByText('workflow.common.disconnect')).not.toBeInTheDocument()

    await user.click(screen.getAllByRole('button')[0]!)
    await user.click(screen.getByText('common.operation.delete'))
    expect(mockHandleNodeDelete).toHaveBeenCalledWith('node-1')
  })
})
