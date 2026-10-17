import type { FileItem } from '@/models/datasets'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FileListItem from '../file-list-item'

vi.mock('@/hooks/use-theme', () => ({ default: () => ({ theme: 'light' }) }))
const createMockFile = (extra = {}) =>
  Object.assign(
    new File(['document'], 'test-document.pdf', {
      type: 'application/pdf',
      lastModified: 1700000000,
    }),
    extra,
  )
const createMockFileItem = (overrides: Partial<FileItem> = {}): FileItem => ({
  fileID: 'file-123',
  file: createMockFile(),
  progress: 100,
  ...overrides,
})
const defaultProps = { fileItem: createMockFileItem(), onPreview: vi.fn(), onRemove: vi.fn() }
beforeEach(() => vi.clearAllMocks())

describe('FileListItem', () => {
  it('supports keyboard preview and removal without triggering both actions', async () => {
    const user = userEvent.setup()
    const fileItem = createMockFileItem({ file: createMockFile({ id: 'uploaded-id' }) })
    render(<FileListItem {...defaultProps} fileItem={fileItem} />)
    await user.tab()
    expect(
      screen.getByRole('button', { name: 'datasetCreation.stepOne.filePreview test-document.pdf' }),
    ).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(defaultProps.onPreview).toHaveBeenCalledWith(fileItem.file)
    await user.tab()
    expect(
      screen.getByRole('button', { name: 'common.operation.remove test-document.pdf' }),
    ).toHaveFocus()
    await user.keyboard(' ')
    expect(defaultProps.onRemove).toHaveBeenCalledWith(fileItem.fileID)
    expect(defaultProps.onPreview).toHaveBeenCalledOnce()
  })

  it('keeps an unuploaded file unavailable for preview while allowing removal', async () => {
    const user = userEvent.setup()
    render(<FileListItem {...defaultProps} fileItem={createMockFileItem({ progress: -1 })} />)
    await user.click(
      screen.getByRole('button', { name: 'datasetCreation.stepOne.filePreview test-document.pdf' }),
    )
    expect(defaultProps.onPreview).not.toHaveBeenCalled()
    await user.click(
      screen.getByRole('button', { name: 'common.operation.remove test-document.pdf' }),
    )
    expect(defaultProps.onRemove).toHaveBeenCalledWith('file-123')
    expect(defaultProps.onPreview).not.toHaveBeenCalled()
  })
})
