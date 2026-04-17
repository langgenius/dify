import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VarType } from '@/app/components/workflow/types'
import { WriteMode } from '../../types'
import OperationSelector from '../operation-selector'

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
    DropdownMenuTrigger: ({
      children,
      className,
      disabled,
    }: {
      children: React.ReactNode
      className?: string
      disabled?: boolean
    }) => {
      const { open, setOpen } = useDropdownMenuContext()
      return (
        <button
          type="button"
          className={className}
          disabled={disabled}
          onClick={() => !disabled && setOpen(!open)}
        >
          {children}
        </button>
      )
    },
    DropdownMenuContent: ({ children }: { children: React.ReactNode }) => {
      const { open } = useDropdownMenuContext()
      return open ? <div>{children}</div> : null
    },
    DropdownMenuGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuGroupLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DropdownMenuSeparator: () => <div data-testid="dropdown-separator" />,
    DropdownMenuItem: ({
      children,
      onClick,
    }: {
      children: React.ReactNode
      onClick?: React.MouseEventHandler<HTMLButtonElement>
    }) => {
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

describe('assigner/operation-selector', () => {
  it('shows numeric write modes and emits the selected operation', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    render(
      <OperationSelector
        value={WriteMode.overwrite}
        onSelect={onSelect}
        assignedVarType={VarType.number}
        writeModeTypes={[WriteMode.overwrite, WriteMode.clear, WriteMode.set]}
        writeModeTypesArr={[WriteMode.overwrite, WriteMode.clear]}
        writeModeTypesNum={[WriteMode.increment]}
      />,
    )

    await user.click(screen.getByText('workflow.nodes.assigner.operations.over-write'))

    expect(screen.getByText('workflow.nodes.assigner.operations.title')).toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.assigner.operations.clear')).toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.assigner.operations.set')).toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.assigner.operations.+=')).toBeInTheDocument()

    await user.click(screen.getAllByText('workflow.nodes.assigner.operations.+=').at(-1)!)

    expect(onSelect).toHaveBeenCalledWith({ value: WriteMode.increment, name: WriteMode.increment })
  })

  it('does not open when the selector is disabled', async () => {
    const user = userEvent.setup()

    render(
      <OperationSelector
        value={WriteMode.overwrite}
        onSelect={vi.fn()}
        disabled
        assignedVarType={VarType.string}
        writeModeTypes={[WriteMode.overwrite]}
      />,
    )

    await user.click(screen.getByText('workflow.nodes.assigner.operations.over-write'))

    expect(screen.queryByText('workflow.nodes.assigner.operations.title')).not.toBeInTheDocument()
  })
})
