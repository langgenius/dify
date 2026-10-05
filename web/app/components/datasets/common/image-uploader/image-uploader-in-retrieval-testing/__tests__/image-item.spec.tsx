import type { ImagePreviewPayload } from '../../../image-previewer'
import type { FileEntity } from '../../types'
import { createDialogHandle } from '@langgenius/dify-ui/dialog'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ImagePreviewer } from '../../../image-previewer'
import { ImageItem } from '../image-item'

const file: FileEntity = {
  id: 'one',
  name: 'local.png',
  progress: 50,
  base64Url: 'data:image/png;base64,local',
  sourceUrl: 'https://example.com/remote.png',
  size: 10,
  extension: 'png',
  mimeType: 'image/png',
}

function Fixture({ progress = 50, disabled = false, onRemove = vi.fn(), onReUpload = vi.fn() }) {
  const [handle] = useState(createDialogHandle<ImagePreviewPayload>)
  return (
    <>
      <ImageItem
        file={{ ...file, progress }}
        showDeleteAction
        disabled={disabled}
        onRemove={onRemove}
        onReUpload={onReUpload}
        previewHandle={handle}
        previewPayload={{
          images: [{ name: file.name, url: file.base64Url!, size: file.size }],
          initialIndex: 0,
        }}
      />
      <ImagePreviewer handle={handle} />
    </>
  )
}

it('previews local images during upload by keyboard and returns to the same entry', async () => {
  const user = userEvent.setup()
  render(<Fixture />)
  const trigger = screen.getByRole('button', { name: file.name })
  trigger.focus()
  await user.keyboard('{Enter}')
  const dialog = screen.getByRole('dialog', { name: file.name })
  expect(within(dialog).getByAltText(file.name)).toHaveAttribute('src', file.base64Url)
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.close' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(trigger).toHaveFocus()
})

it('keeps removal and retry separate from the preview action', async () => {
  const user = userEvent.setup()
  const onRemove = vi.fn()
  const onReUpload = vi.fn()
  render(<Fixture progress={-1} onRemove={onRemove} onReUpload={onReUpload} />)
  await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))
  expect(onRemove).toHaveBeenCalledWith('one')
  screen.getByRole('button', { name: 'common.operation.retry' }).focus()
  await user.keyboard('{Enter}')
  expect(onReUpload).toHaveBeenCalledWith('one')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('blocks mutations when disabled while retaining read-only preview', async () => {
  const user = userEvent.setup()
  const onRemove = vi.fn()
  const onReUpload = vi.fn()
  render(<Fixture progress={-1} disabled onRemove={onRemove} onReUpload={onReUpload} />)
  await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
  await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))
  expect(onRemove).not.toHaveBeenCalled()
  expect(onReUpload).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: file.name }))
  expect(screen.getByRole('dialog', { name: file.name })).toBeInTheDocument()
})
