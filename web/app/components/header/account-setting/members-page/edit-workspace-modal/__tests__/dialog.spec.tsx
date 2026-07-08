import type { ReactNode } from 'react'
import type { AppContextValue } from '@/context/app-context'
import { render } from '@testing-library/react'
import EditWorkspaceModal from '../index'

type DialogProps = {
  children: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

let latestOnOpenChange: DialogProps['onOpenChange']
const mockAppContextState = vi.hoisted(() => ({
  current: {} as Partial<AppContextValue>,
}))
const mockUseAppContext = vi.hoisted(() => vi.fn())

vi.mock('@langgenius/dify-ui/dialog', () => ({
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
  useAppContext: mockUseAppContext,
}))

vi.mock('@/context/app-context-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => mockAppContextState.current)
})

vi.mock('jotai', async (importOriginal) => {
  const { createAppContextStateJotaiMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateJotaiMock(importOriginal)
})

describe('EditWorkspaceModal dialog lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    latestOnOpenChange = undefined
    const appContextValue = {
      currentWorkspace: { name: 'Test Workspace' },
      isCurrentWorkspaceOwner: true,
    } as never
    mockAppContextState.current = appContextValue
    mockUseAppContext.mockReturnValue(appContextValue)
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
