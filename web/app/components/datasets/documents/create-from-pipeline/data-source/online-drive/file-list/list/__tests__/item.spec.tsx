import type { OnlineDriveFile } from '@/models/pipeline'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Item from '../item'

vi.mock('@/app/components/base/checkbox', () => ({
  default: ({ checked, onCheck, disabled }: { checked: boolean, onCheck: () => void, disabled?: boolean }) => (
    <input type="checkbox" data-testid="checkbox" checked={checked} onChange={onCheck} disabled={disabled} />
  ),
}))

vi.mock('@/app/components/base/radio/ui', () => ({
  default: ({ isChecked, onCheck }: { isChecked: boolean, onCheck: () => void }) => (
    <input type="radio" data-testid="radio" checked={isChecked} onChange={onCheck} />
  ),
}))

vi.mock('@/app/components/base/tooltip', () => ({
  default: ({ children, popupContent }: { children: React.ReactNode, popupContent: string }) => (
    <div data-testid="tooltip" title={popupContent}>{children}</div>
  ),
}))

vi.mock('../file-icon', () => ({
  default: () => <span data-testid="file-icon" />,
}))

describe('Item', () => {
  const makeFile = (type: string, name = 'test.pdf', size = 1024): OnlineDriveFile => ({
    id: 'f-1',
    name,
    type: type as OnlineDriveFile['type'],
    size,
  })

  const defaultProps = {
    file: makeFile('file'),
    isSelected: false,
    onSelect: vi.fn(),
    onOpen: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render file name', () => {
    render(<Item {...defaultProps} />)
    expect(screen.getByText('test.pdf')).toBeInTheDocument()
  })

  it('should render checkbox for file type in multiple choice mode', () => {
    render(<Item {...defaultProps} />)
    expect(screen.getByTestId('checkbox')).toBeInTheDocument()
  })

  it('should render radio for file type in single choice mode', () => {
    render(<Item {...defaultProps} isMultipleChoice={false} />)
    expect(screen.getByTestId('radio')).toBeInTheDocument()
  })

  it('should not render checkbox for bucket type', () => {
    render(<Item {...defaultProps} file={makeFile('bucket', 'my-bucket')} />)
    expect(screen.queryByTestId('checkbox')).not.toBeInTheDocument()
  })

  it('should call onOpen for folder click', () => {
    const file = makeFile('folder', 'my-folder')
    render(<Item {...defaultProps} file={file} />)
    fireEvent.click(screen.getByText('my-folder'))
    expect(defaultProps.onOpen).toHaveBeenCalledWith(file)
  })

  it('should call onSelect for file click', () => {
    render(<Item {...defaultProps} />)
    fireEvent.click(screen.getByText('test.pdf'))
    expect(defaultProps.onSelect).toHaveBeenCalledWith(defaultProps.file)
  })

  it('should not call handlers when disabled', () => {
    render(<Item {...defaultProps} disabled={true} />)
    fireEvent.click(screen.getByText('test.pdf'))
    expect(defaultProps.onSelect).not.toHaveBeenCalled()
  })

  it('should render file icon', () => {
    render(<Item {...defaultProps} />)
    expect(screen.getByTestId('file-icon')).toBeInTheDocument()
  })
})
