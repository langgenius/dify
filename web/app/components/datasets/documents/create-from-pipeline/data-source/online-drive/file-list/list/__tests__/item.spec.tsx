import type { OnlineDriveFile } from '@/models/pipeline'
import { RadioGroup } from '@langgenius/dify-ui/radio-group'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Item from '../item'

describe('Item', () => {
  const makeFile = (
    type: OnlineDriveFile['type'],
    name = 'test.pdf',
    size = 1024,
  ): OnlineDriveFile => ({
    id: 'f-1',
    name,
    type,
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

  it('should render radio for file type in single choice mode', () => {
    render(
      <RadioGroup aria-label="Files" value={defaultProps.file.id}>
        <Item {...defaultProps} isMultipleChoice={false} />
      </RadioGroup>,
    )

    expect(screen.getByRole('radio', { name: 'test.pdf' })).toBeInTheDocument()
  })

  it('should not render checkbox for bucket type', () => {
    render(<Item {...defaultProps} file={makeFile('bucket', 'my-bucket')} />)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('should call onOpen for folder click', async () => {
    const user = userEvent.setup()
    const file = makeFile('folder', 'my-folder')
    render(<Item {...defaultProps} file={file} />)
    await user.click(screen.getByText('my-folder'))
    expect(defaultProps.onOpen).toHaveBeenCalledWith(file)
  })

  it('should call onSelect for file click', async () => {
    const user = userEvent.setup()
    render(<Item {...defaultProps} />)
    await user.click(screen.getByText('test.pdf'))
    expect(defaultProps.onSelect).toHaveBeenCalledWith(defaultProps.file)
  })

  it('should call onSelect once without bubbling to row click when checkbox is clicked', async () => {
    const user = userEvent.setup()
    render(<Item {...defaultProps} />)

    await user.click(screen.getByRole('checkbox', { name: 'test.pdf' }))

    expect(defaultProps.onSelect).toHaveBeenCalledTimes(1)
    expect(defaultProps.onSelect).toHaveBeenCalledWith(defaultProps.file)
    expect(defaultProps.onOpen).not.toHaveBeenCalled()
  })

  it('should not call handlers when disabled', async () => {
    const user = userEvent.setup()
    render(<Item {...defaultProps} disabled={true} />)
    await user.click(screen.getByText('test.pdf'))
    expect(defaultProps.onSelect).not.toHaveBeenCalled()
  })
})
