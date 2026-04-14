import type { ReactNode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import ModelSelector from '../index'

type PopoverProps = {
  children: ReactNode
  onOpenChange?: (open: boolean) => void
}

let latestOnOpenChange: PopoverProps['onOpenChange']

vi.mock('../../hooks', () => ({
  useCurrentProviderAndModel: () => ({
    currentProvider: undefined,
    currentModel: undefined,
  }),
}))

vi.mock('@/app/components/base/ui/popover', () => ({
  Popover: ({ children, onOpenChange }: PopoverProps) => {
    latestOnOpenChange = onOpenChange
    return <div>{children}</div>
  },
  PopoverTrigger: ({ render }: { render: ReactNode }) => <>{render}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('../model-selector-trigger', () => ({
  default: ({ open, readonly }: { open: boolean, readonly?: boolean }) => (
    <span>
      {open ? 'open' : 'closed'}
      -
      {readonly ? 'readonly' : 'editable'}
    </span>
  ),
}))

vi.mock('../popup', () => ({
  default: ({ onHide }: { onHide: () => void }) => (
    <div data-testid="popup">
      <button type="button" onClick={onHide}>hide-popup</button>
    </div>
  ),
}))

describe('ModelSelector popover branches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    latestOnOpenChange = undefined
  })

  it('should open and close through popover callbacks when editable', () => {
    const onHide = vi.fn()
    render(<ModelSelector modelList={[]} onHide={onHide} />)

    act(() => {
      latestOnOpenChange?.(true)
    })

    expect(screen.getByText('open-editable')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'hide-popup' }))

    expect(screen.getByText('closed-editable')).toBeInTheDocument()
    expect(onHide).toHaveBeenCalledTimes(1)
  })

  it('should ignore popover open changes when readonly', () => {
    render(<ModelSelector modelList={[]} readonly />)

    act(() => {
      latestOnOpenChange?.(true)
    })

    expect(screen.getByText('closed-readonly')).toBeInTheDocument()
  })
})
