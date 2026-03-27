import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CreateFromDSLModal, { CreateFromDSLModalTab } from '../index'

const mockUseCreateFromDSLModal = vi.fn()
const mockDSLConfirmModal = vi.fn()

vi.mock('@/app/components/base/ui/dialog', () => ({
  Dialog: ({
    children,
    onOpenChange,
    open,
  }: {
    children: ReactNode
    onOpenChange?: (open: boolean) => void
    open: boolean
  }) => (open
    ? (
        <div>
          <button type="button" onClick={() => onOpenChange?.(false)}>close dialog</button>
          {children}
        </div>
      )
    : null),
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('../use-create-from-dsl-modal', () => ({
  useCreateFromDSLModal: (params: unknown) => mockUseCreateFromDSLModal(params),
}))

vi.mock('../dsl-confirm-modal', () => ({
  default: ({ onCancel }: { onCancel: () => void }) => {
    mockDSLConfirmModal(onCancel)
    return <button type="button" onClick={onCancel}>close confirm modal</button>
  },
}))

const baseHookState = {
  buttonDisabled: false,
  currentFile: undefined,
  currentTab: CreateFromDSLModalTab.FROM_FILE,
  docHref: 'https://docs.example.com/app-management',
  dslUrlValue: '',
  handleConfirmSuccess: vi.fn(),
  handleCreate: vi.fn(),
  handleDSLConfirm: vi.fn(),
  handleFile: vi.fn(),
  isAppsFull: false,
  isCreating: false,
  isZipFile: vi.fn(() => false),
  learnMoreLabel: 'Learn more',
  setCurrentTab: vi.fn(),
  setDslUrlValue: vi.fn(),
  setShowErrorModal: vi.fn(),
  showErrorModal: false,
  tabs: [
    { key: CreateFromDSLModalTab.FROM_FILE, label: 'Import from file' },
    { key: CreateFromDSLModalTab.FROM_URL, label: 'Import from URL' },
  ],
  versions: undefined,
}

describe('CreateFromDSLModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseCreateFromDSLModal.mockReturnValue(baseHookState)
  })

  it('should render the file tab content by default', () => {
    render(<CreateFromDSLModal show={true} onClose={vi.fn()} />)

    expect(screen.getByText('Import from file')).toBeInTheDocument()
    expect(screen.getByText('Learn more')).toHaveAttribute('href', 'https://docs.example.com/app-management')
  })

  it('should render the URL input when the hook reports the URL tab', () => {
    mockUseCreateFromDSLModal.mockReturnValue({
      ...baseHookState,
      currentTab: CreateFromDSLModalTab.FROM_URL,
      dslUrlValue: 'https://example.com/app.yml',
    })

    render(<CreateFromDSLModal show={true} onClose={vi.fn()} activeTab={CreateFromDSLModalTab.FROM_URL} />)

    expect(screen.getByDisplayValue('https://example.com/app.yml')).toBeInTheDocument()
  })

  it('should forward tab and input changes to the hook setters', () => {
    render(<CreateFromDSLModal show={true} onClose={vi.fn()} />)

    fireEvent.click(screen.getByText('Import from URL'))
    expect(baseHookState.setCurrentTab).toHaveBeenCalledWith(CreateFromDSLModalTab.FROM_URL)

    mockUseCreateFromDSLModal.mockReturnValue({
      ...baseHookState,
      currentTab: CreateFromDSLModalTab.FROM_URL,
    })

    render(<CreateFromDSLModal show={true} onClose={vi.fn()} activeTab={CreateFromDSLModalTab.FROM_URL} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'https://example.com/next.yml' } })
    expect(baseHookState.setDslUrlValue).toHaveBeenCalledWith('https://example.com/next.yml')
  })

  it('should call the create handler when import is clicked', () => {
    render(<CreateFromDSLModal show={true} onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /app\.newApp\.import/i }))
    expect(baseHookState.handleCreate).toHaveBeenCalledTimes(1)
  })

  it('should close when the dialog requests close and when the header close button is clicked', () => {
    const onClose = vi.fn()
    const { container, rerender } = render(<CreateFromDSLModal show={true} onClose={onClose} />)

    fireEvent.click(screen.getByText('close dialog'))
    expect(onClose).toHaveBeenCalledTimes(1)

    rerender(<CreateFromDSLModal show={true} onClose={onClose} />)
    fireEvent.click(container.querySelector('.cursor-pointer')!)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('should render the confirm modal and wire its cancel handler back to the hook state setter', () => {
    mockUseCreateFromDSLModal.mockReturnValue({
      ...baseHookState,
      showErrorModal: true,
      currentFile: new File(['dsl'], 'demo.yml', { type: 'text/yaml' }),
      versions: {
        importedVersion: '0.9.0',
        systemVersion: '1.0.0',
      },
    })

    render(<CreateFromDSLModal show={true} onClose={vi.fn()} />)

    fireEvent.click(screen.getByText('close confirm modal'))
    expect(baseHookState.setShowErrorModal).toHaveBeenCalledWith(false)
  })
})
