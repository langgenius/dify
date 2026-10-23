import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FileThumb from '../index'

describe('FileThumb', () => {
  it('selects the named file without triggering its enclosing action', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    const onParentClick = vi.fn()
    const file = {
      name: 'report.pdf',
      mimeType: 'application/pdf',
      extension: '.pdf',
      size: 2048,
      sourceUrl: 'https://example.com/report.pdf',
    }
    render(
      <div role="presentation" onClick={onParentClick}>
        <FileThumb file={file} onClick={onClick} />
      </div>,
    )

    await user.click(screen.getByRole('button', { name: 'report.pdf' }))

    expect(onClick).toHaveBeenCalledExactlyOnceWith(file)
    expect(onParentClick).not.toHaveBeenCalled()
  })

  it('reports the file when its image fails to load', () => {
    const onError = vi.fn()
    const file = {
      name: 'photo.png',
      mimeType: 'image/png',
      extension: '.png',
      size: 2048,
      sourceUrl: 'https://example.com/photo.png',
    }
    render(<FileThumb file={file} onError={onError} />)
    fireEvent.error(screen.getByAltText('photo.png'))
    expect(onError).toHaveBeenCalledExactlyOnceWith(file)
  })
})
