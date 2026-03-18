import type { ReactNode } from 'react'
import { render } from '@testing-library/react'
import MenuDialog from '../menu-dialog'

type DialogProps = {
  children: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

let latestOnOpenChange: DialogProps['onOpenChange']

vi.mock('@/app/components/base/ui/dialog', () => ({
  Dialog: ({ children, onOpenChange }: DialogProps) => {
    latestOnOpenChange = onOpenChange
    return <div data-testid="dialog">{children}</div>
  },
  DialogContent: ({ children, className }: { children: ReactNode, className?: string }) => (
    <div className={className}>{children}</div>
  ),
}))

describe('MenuDialog dialog lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    latestOnOpenChange = undefined
  })

  it('should only call onClose when the dialog requests closing', () => {
    const onClose = vi.fn()
    render(
      <MenuDialog show={true} onClose={onClose}>
        <div>Content</div>
      </MenuDialog>,
    )

    latestOnOpenChange?.(true)
    latestOnOpenChange?.(false)

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
