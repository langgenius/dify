import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { FileThumb } from '../index'

const file = {
  name: 'test-image.jpg',
  mimeType: 'image/jpeg',
  extension: 'jpg',
  size: 1024,
  sourceUrl: 'https://example.com/test-image.jpg',
}

it('forwards native button focus, keyboard events and disabled semantics', async () => {
  const user = userEvent.setup()
  const ref = createRef<HTMLButtonElement>()
  const onClick = vi.fn()
  const { rerender } = render(<FileThumb ref={ref} file={file} onClick={onClick} />)
  ref.current?.focus()
  expect(screen.getByRole('button', { name: file.name })).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(onClick).toHaveBeenCalledOnce()
  expect(onClick.mock.calls[0]![0].defaultPrevented).toBe(false)
  expect(screen.getByAltText(file.name)).toHaveAttribute('src', file.sourceUrl)
  rerender(<FileThumb file={file} onClick={onClick} disabled />)
  await user.click(screen.getByRole('button', { name: file.name }))
  expect(onClick).toHaveBeenCalledOnce()
})

it('retains a named file entry for non-image files', () => {
  render(<FileThumb file={{ ...file, name: 'report.pdf', mimeType: 'application/pdf' }} />)
  expect(screen.getByRole('button', { name: 'report.pdf' })).toBeInTheDocument()
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
})
