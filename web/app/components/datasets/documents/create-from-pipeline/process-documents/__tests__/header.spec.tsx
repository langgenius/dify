import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import Header from '../header'

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
    expect(
      screen.getByText('datasetPipeline.addDocuments.stepTwo.chunkSettings'),
    ).toBeInTheDocument()
  })

  it('should render reset and preview buttons', () => {
    render(<Header {...defaultProps} />)
    expect(screen.getByRole('button', { name: 'common.operation.reset' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'datasetPipeline.addDocuments.stepTwo.previewChunks' }),
    ).toBeInTheDocument()
  })

  it('should call onReset when reset clicked', () => {
    render(<Header {...defaultProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.reset' }))
    expect(defaultProps.onReset).toHaveBeenCalled()
  })

  it('should call onPreview when preview clicked', () => {
    render(<Header {...defaultProps} />)
    fireEvent.click(
      screen.getByRole('button', { name: 'datasetPipeline.addDocuments.stepTwo.previewChunks' }),
    )
    expect(defaultProps.onPreview).toHaveBeenCalled()
  })

  it('should disable reset button when resetDisabled is true', () => {
    render(<Header {...defaultProps} resetDisabled={true} />)
    expect(screen.getByRole('button', { name: 'common.operation.reset' })).toBeDisabled()
  })

  it('should disable preview button when previewDisabled is true', () => {
    render(<Header {...defaultProps} previewDisabled={true} />)
    expect(
      screen.getByRole('button', { name: 'datasetPipeline.addDocuments.stepTwo.previewChunks' }),
    ).toBeDisabled()
  })
})
