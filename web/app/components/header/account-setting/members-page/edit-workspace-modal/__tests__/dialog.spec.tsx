import type { ReactNode } from 'react'
import { render } from '@testing-library/react'
import { useAppContext } from '@/context/app-context'
import EditWorkspaceModal from '../index'

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
  DialogCloseButton: ({ ...props }: Record<string, unknown>) => <button {...props} />,
  DialogContent: ({ children, className }: { children: ReactNode, className?: string }) => (
    <div className={className}>{children}</div>
  ),
  DialogTitle: ({ children, className }: { children: ReactNode, className?: string }) => (
    <div className={className}>{children}</div>
  ),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: vi.fn(),
}))

describe('EditWorkspaceModal dialog lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    latestOnOpenChange = undefined
    vi.mocked(useAppContext).mockReturnValue({
      currentWorkspace: { name: 'Test Workspace' },
      isCurrentWorkspaceOwner: true,
    } as never)
  })

  it('should only call onCancel when the dialog requests closing', () => {
    const onCancel = vi.fn()

    render(
      <>
        <EditWorkspaceModal onCancel={onCancel} />
      </>,
    )

    latestOnOpenChange?.(true)
    latestOnOpenChange?.(false)

    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
