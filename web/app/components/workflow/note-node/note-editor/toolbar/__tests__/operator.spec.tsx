import type {
  MouseEvent,
  MouseEventHandler,
  ReactElement,
  ReactNode,
} from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Operator from '../operator'

type DropdownTriggerRenderProps = {
  'className'?: string
  'role'?: string
  'aria-label'?: string
  'onMouseDown'?: MouseEventHandler<HTMLDivElement>
  'onClick'?: MouseEventHandler<HTMLDivElement>
}

type DropdownTriggerProps = {
  'children': ReactNode
  'className'?: string
  'render'?: ReactElement<DropdownTriggerRenderProps>
  'onMouseDown'?: MouseEventHandler<HTMLDivElement>
  'onClick'?: MouseEventHandler<HTMLDivElement>
  'aria-label'?: string
}

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
    DropdownMenuTrigger: ({
      children,
      className,
      render,
      onMouseDown,
      onClick,
      'aria-label': ariaLabel,
    }: DropdownTriggerProps) => {
      const { open, setOpen } = useDropdownMenuContext()
      if (render) {
        const handleMouseDown = (event: MouseEvent<HTMLDivElement>) => {
          const baseUiEvent = event as MouseEvent<HTMLDivElement> & { preventBaseUIHandler?: () => void }
          baseUiEvent.preventBaseUIHandler = vi.fn()
          onMouseDown?.(baseUiEvent)
          render.props.onMouseDown?.(event)
        }

        const handleClick = (event: MouseEvent<HTMLDivElement>) => {
          onClick?.(event)
          render.props.onClick?.(event)
          if (!onMouseDown)
            setOpen(!open)
        }

        return (
          <div
            role={render.props.role ?? 'button'}
            aria-label={render.props['aria-label'] ?? ariaLabel}
            className={render.props.className ?? className}
            onMouseDown={handleMouseDown}
            onClick={handleClick}
          >
            {children}
          </div>
        )
      }

      return (
        <button
          type="button"
          className={className}
          onClick={() => setOpen(!open)}
        >
          {children}
        </button>
      )
    },
    DropdownMenuContent: ({ children }: { children: ReactNode }) => {
      const { open } = useDropdownMenuContext()
      return open ? <div>{children}</div> : null
    },
    DropdownMenuItem: ({
      children,
      onClick,
      className,
    }: {
      children: ReactNode
      onClick?: MouseEventHandler<HTMLButtonElement>
      className?: string
    }) => {
      const { setOpen } = useDropdownMenuContext()
      return (
        <button
          type="button"
          className={className}
          onClick={(event) => {
            onClick?.(event)
            setOpen(false)
          }}
        >
          {children}
        </button>
      )
    },
    DropdownMenuSeparator: ({ className }: { className?: string }) => <div className={className} data-testid="dropdown-separator" />,
  }
})

const renderOperator = (showAuthor = false) => {
  const onCopy = vi.fn()
  const onDuplicate = vi.fn()
  const onDelete = vi.fn()
  const onShowAuthorChange = vi.fn()

  render(
    <Operator
      onCopy={onCopy}
      onDuplicate={onDuplicate}
      onDelete={onDelete}
      showAuthor={showAuthor}
      onShowAuthorChange={onShowAuthorChange}
    />,
  )

  return {
    onCopy,
    onDelete,
    onDuplicate,
    onShowAuthorChange,
  }
}

describe('NoteEditor Toolbar Operator', () => {
  it('triggers copy, duplicate, and delete from the opened menu', async () => {
    const user = userEvent.setup()
    const {
      onCopy,
      onDelete,
      onDuplicate,
    } = renderOperator()

    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
    await user.click(screen.getByText('workflow.common.copy'))
    expect(onCopy).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
    await user.click(screen.getByText('workflow.common.duplicate'))
    expect(onDuplicate).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
    await user.click(screen.getByText('common.operation.delete'))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('keeps the menu open when toggling show author', async () => {
    const user = userEvent.setup()
    const { onShowAuthorChange } = renderOperator(true)

    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
    await user.click(screen.getByRole('switch'))

    expect(onShowAuthorChange).toHaveBeenCalledWith(false)
    expect(screen.getByText('workflow.nodes.note.editor.showAuthor')).toBeInTheDocument()
  })
})
