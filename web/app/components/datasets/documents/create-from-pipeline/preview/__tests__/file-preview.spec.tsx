import type { CustomFile } from '@/models/datasets'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import FilePreview from '../file-preview'

const mockFileData = { content: 'file content here with some text' }
let mockIsFetching = false

vi.mock('@/service/use-common', () => ({
  useFilePreview: () => ({
    data: mockIsFetching ? undefined : mockFileData,
    isFetching: mockIsFetching,
  }),
}))

vi.mock('../../../../common/document-file-icon', () => ({
  default: () => <span data-testid="file-icon" />,
}))

vi.mock('../loading', () => ({
  default: () => <div data-testid="loading" />,
}))

describe('FilePreview', () => {
  const defaultProps = {
    file: {
      id: 'file-1',
      name: 'document.pdf',
      extension: 'pdf',
      size: 1024,
    } as CustomFile,
    hidePreview: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockIsFetching = false
  })

  it('should render preview label', () => {
    render(<FilePreview {...defaultProps} />)
    expect(screen.getByText('datasetPipeline.addDocuments.stepOne.preview')).toBeInTheDocument()
  })

  it('should render file name', () => {
    render(<FilePreview {...defaultProps} />)
    expect(screen.getByText('document.pdf')).toBeInTheDocument()
  })

  it('should render file content when loaded', () => {
    render(<FilePreview {...defaultProps} />)
    expect(screen.getByText('file content here with some text')).toBeInTheDocument()
  })

  it('should render loading state', () => {
    mockIsFetching = true
    render(<FilePreview {...defaultProps} />)
    expect(screen.getByTestId('loading')).toBeInTheDocument()
  })

  it('should call hidePreview when close button clicked', () => {
    render(<FilePreview {...defaultProps} />)
    const buttons = screen.getAllByRole('button')
    const closeBtn = buttons[buttons.length - 1]
    fireEvent.click(closeBtn)
    expect(defaultProps.hidePreview).toHaveBeenCalled()
  })
})
