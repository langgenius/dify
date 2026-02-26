import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Header from '../header'

vi.mock('@/app/components/base/button', () => ({
  default: ({ children, onClick, disabled, variant }: { children: React.ReactNode, onClick: () => void, disabled?: boolean, variant: string }) => (
    <button data-testid={`btn-${variant}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}))

describe('Header', () => {
  const defaultProps = {
    onReset: vi.fn(),
    resetDisabled: false,
    previewDisabled: false,
    onPreview: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render chunk settings title', () => {
    render(<Header {...defaultProps} />)
    expect(screen.getByText('datasetPipeline.addDocuments.stepTwo.chunkSettings')).toBeInTheDocument()
  })

  it('should render reset and preview buttons', () => {
    render(<Header {...defaultProps} />)
    expect(screen.getByTestId('btn-ghost')).toBeInTheDocument()
    expect(screen.getByTestId('btn-secondary-accent')).toBeInTheDocument()
  })

  it('should call onReset when reset clicked', () => {
    render(<Header {...defaultProps} />)
    fireEvent.click(screen.getByTestId('btn-ghost'))
    expect(defaultProps.onReset).toHaveBeenCalled()
  })

  it('should call onPreview when preview clicked', () => {
    render(<Header {...defaultProps} />)
    fireEvent.click(screen.getByTestId('btn-secondary-accent'))
    expect(defaultProps.onPreview).toHaveBeenCalled()
  })

  it('should disable reset button when resetDisabled is true', () => {
    render(<Header {...defaultProps} resetDisabled={true} />)
    expect(screen.getByTestId('btn-ghost')).toBeDisabled()
  })

  it('should disable preview button when previewDisabled is true', () => {
    render(<Header {...defaultProps} previewDisabled={true} />)
    expect(screen.getByTestId('btn-secondary-accent')).toBeDisabled()
  })
})
