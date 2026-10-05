import type { ImageInfo, ImagePreviewPayload } from '../index'
import { createDialogHandle, DialogTrigger } from '@langgenius/dify-ui/dialog'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ImagePreviewer } from '../index'

const images: ImageInfo[] = [
  { url: 'https://example.com/image1.png', name: 'image1.png', size: 1024 },
  { url: 'https://example.com/image2.png', name: 'image2.png', size: 2048 },
  { url: 'https://example.com/image3.png', name: 'image3.png', size: 3072 },
]

function Gallery({ items = images }: { items?: readonly ImageInfo[] }) {
  const [handle] = useState(() => createDialogHandle<ImagePreviewPayload>())
  return (
    <>
      {items.map((image, initialIndex) => (
        <DialogTrigger key={image.url} handle={handle} payload={{ images: items, initialIndex }}>
          Preview {image.name || 'unnamed image'}
        </DialogTrigger>
      ))}
      <ImagePreviewer handle={handle} />
    </>
  )
}

function finishImageLoad(image: HTMLElement, width = 800, height = 600) {
  Object.defineProperties(image, {
    naturalWidth: { configurable: true, value: width },
    naturalHeight: { configurable: true, value: height },
  })
  fireEvent.load(image)
}

const getNavigation = (dialog: HTMLElement) => ({
  previous: within(dialog).getByRole('button', { name: 'common.pagination.previous' }),
  next: within(dialog).getByRole('button', { name: 'common.pagination.next' }),
})

describe('ImagePreviewer', () => {
  it('loads the selected native image and displays its dimensions and file size', async () => {
    const user = userEvent.setup()
    render(<Gallery />)
    await user.click(screen.getByRole('button', { name: 'Preview image2.png' }))
    const dialog = await screen.findByRole('dialog', { name: 'image2.png' })
    expect(within(dialog).getByRole('progressbar')).toBeInTheDocument()
    const image = within(dialog).getByAltText('image2.png')
    expect(image).toHaveAttribute('src', images[1]?.url)
    expect(within(dialog).queryByAltText('image1.png')).not.toBeInTheDocument()
    finishImageLoad(image)
    expect(within(dialog).queryByRole('progressbar')).not.toBeInTheDocument()
    expect(within(dialog).getByRole('img', { name: 'image2.png' })).toBeVisible()
    expect(within(dialog).getByText(/800.*600/)).toBeInTheDocument()
    expect(within(dialog).getByText('2.00 KB')).toBeInTheDocument()
  })

  it('handles decoding failure and retries the same native source', async () => {
    const user = userEvent.setup()
    render(<Gallery />)
    await user.click(screen.getByRole('button', { name: 'Preview image1.png' }))
    const dialog = await screen.findByRole('dialog', { name: 'image1.png' })
    fireEvent.error(within(dialog).getByAltText('image1.png'))
    expect(
      within(dialog).getByText('common.imageUploader.uploadFromComputerReadError'),
    ).toBeInTheDocument()
    expect(within(dialog).queryByAltText('image1.png')).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('progressbar')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.retry' }))
    expect(within(dialog).getByRole('progressbar')).toBeInTheDocument()
    const image = within(dialog).getByAltText('image1.png')
    expect(image).toHaveAttribute('src', images[0]?.url)
    finishImageLoad(image, 320, 240)
    expect(within(dialog).getByText(/320.*240/)).toBeInTheDocument()
    expect(
      within(dialog).queryByRole('button', { name: 'common.operation.retry' }),
    ).not.toBeInTheDocument()
  })

  it('loads a local data image and keeps a localized name for an unnamed image', async () => {
    const user = userEvent.setup()
    const url = 'data:image/png;base64,iVBORw0KGgo='
    render(<Gallery items={[{ url, name: '', size: 50 }]} />)
    await user.click(screen.getByRole('button', { name: 'Preview unnamed image' }))
    const dialog = await screen.findByRole('dialog', { name: 'workflow.common.preview' })
    const image = within(dialog).getByAltText('')
    expect(image).toHaveAttribute('src', url)
    finishImageLoad(image)
    const { previous, next } = getNavigation(dialog)
    expect(previous).toBeDisabled()
    expect(next).toBeDisabled()
  })

  it('navigates the session with buttons and one step per held arrow', async () => {
    const user = userEvent.setup()
    render(<Gallery />)
    await user.click(screen.getByRole('button', { name: 'Preview image1.png' }))
    const dialog = await screen.findByRole('dialog', { name: 'image1.png' })
    const { previous, next } = getNavigation(dialog)
    expect(previous).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'common.operation.close' })).toHaveFocus()
    await user.keyboard('{ArrowRight>3/}')
    expect(dialog).toHaveAccessibleName('image2.png')
    await user.keyboard('{ArrowRight}')
    expect(dialog).toHaveAccessibleName('image3.png')
    expect(next).toBeDisabled()
    await user.keyboard('{ArrowRight>3/}')
    expect(dialog).toHaveAccessibleName('image3.png')
    await user.keyboard('{ArrowLeft}')
    expect(dialog).toHaveAccessibleName('image2.png')
    await user.click(previous)
    expect(dialog).toHaveAccessibleName('image1.png')
    expect(previous).toBeDisabled()
    await user.click(next)
    expect(dialog).toHaveAccessibleName('image2.png')
  })

  it('keeps the opened image list when an active trigger receives a shorter live payload', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<Gallery />)
    await user.click(screen.getByRole('button', { name: 'Preview image1.png' }))
    const dialog = await screen.findByRole('dialog', { name: 'image1.png' })
    await user.click(getNavigation(dialog).next)
    await user.click(getNavigation(dialog).next)
    expect(dialog).toHaveAccessibleName('image3.png')
    rerender(<Gallery items={images.slice(0, 1)} />)
    expect(dialog).toHaveAccessibleName('image3.png')
    await user.click(getNavigation(dialog).previous)
    expect(dialog).toHaveAccessibleName('image2.png')
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Preview image1.png' }))
    const reopened = await screen.findByRole('dialog', { name: 'image1.png' })
    expect(getNavigation(reopened).next).toBeDisabled()
  })

  it('does not dismiss from content clicks and restores the actual detached trigger', async () => {
    const user = userEvent.setup()
    render(<Gallery />)
    const trigger = screen.getByRole('button', { name: 'Preview image2.png' })
    await user.click(trigger)
    const dialog = await screen.findByRole('dialog', { name: 'image2.png' })
    await user.click(dialog)
    expect(dialog).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
    await user.keyboard('{Enter}')
    await screen.findByRole('dialog', { name: 'image2.png' })
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('keeps independent galleries separate when one is closed', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Gallery items={images.slice(0, 1)} />
        <Gallery items={images.slice(1, 2)} />
      </>,
    )
    await user.click(screen.getByRole('button', { name: 'Preview image1.png' }))
    const first = await screen.findByRole('dialog', { name: 'image1.png' })
    finishImageLoad(within(first).getByAltText('image1.png'))
    await user.click(within(first).getByRole('button', { name: 'common.operation.close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Preview image2.png' }))
    const second = await screen.findByRole('dialog', { name: 'image2.png' })
    finishImageLoad(within(second).getByAltText('image2.png'), 640, 480)
    expect(within(second).getByText(/640.*480/)).toBeInTheDocument()
    expect(within(second).getByRole('img', { name: 'image2.png' })).toHaveAttribute(
      'src',
      images[1]?.url,
    )
  })
})
