import { createInstance } from 'i18next'
import { useState } from 'react'
import { I18nextProvider } from 'react-i18next'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import common from '@/i18n/locales/en-US/common.json'
import image from '@/test/fixtures/media/preview.svg?url&inline'
import ImageGallery from '..'

vi.unmock('react-i18next')

async function renderGallery(srcs = [image]) {
  const i18n = createInstance()
  await i18n.init({ lng: 'en-US', resources: { 'en-US': { common } }, keySeparator: false })
  function EmbeddingOwner({ mounted = true }: { mounted?: boolean }) {
    const [open, setOpen] = useState(false)
    return (
      <>
        <output aria-label="Embedding shortcuts">{open ? 'Paused' : 'Enabled'}</output>
        {mounted && <ImageGallery srcs={srcs} onPreviewOpenChange={setOpen} />}
      </>
    )
  }
  const screen = await render(
    <I18nextProvider i18n={i18n}>
      <EmbeddingOwner />
    </I18nextProvider>,
  )
  return {
    ...screen,
    removeGallery: () =>
      screen.rerender(
        <I18nextProvider i18n={i18n}>
          <EmbeddingOwner mounted={false} />
        </I18nextProvider>,
      ),
  }
}

it('pauses embedding shortcuts while a preview is open and releases them on close and removal', async () => {
  const screen = await renderGallery()
  const trigger = screen.getByRole('button', { name: 'Preview image 1 of 1' })
  const state = screen.getByLabelText('Embedding shortcuts')
  await expect.element(state).toHaveTextContent('Enabled')
  await trigger.click()
  await expect.element(screen.getByRole('dialog')).toBeVisible()
  await expect.element(state).toHaveTextContent('Paused')
  await userEvent.keyboard('{Escape}')
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  await expect.element(state).toHaveTextContent('Enabled')
  await trigger.click()
  await expect.element(state).toHaveTextContent('Paused')
  await screen.removeGallery()
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  await expect.element(state).toHaveTextContent('Enabled')
})

it('decodes the selected image in the preview and returns to the gallery after closing', async () => {
  const second = `data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="31" height="19"><rect width="31" height="19" fill="red"/></svg>',
  )}`
  const screen = await renderGallery([image, second])
  const trigger = screen.getByRole('button', { name: 'Preview image 2 of 2' })
  await trigger.click()
  const preview = screen.getByRole('dialog').getByTestId('image-preview-image')
  await expect.element(preview).toBeVisible()
  await expect.poll(() => (preview.element() as HTMLImageElement).naturalWidth).toBe(31)
  expect((preview.element() as HTMLImageElement).currentSrc).toBe(second)
  await userEvent.keyboard('{Escape}')
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  await expect.element(trigger).toBeVisible()
})

it('releases and restores embedding shortcuts on page lifecycle events only while previewing', async () => {
  const screen = await renderGallery()
  const state = screen.getByLabelText('Embedding shortcuts')
  await screen.getByRole('button', { name: 'Preview image 1 of 1' }).click()
  await expect.element(state).toHaveTextContent('Paused')
  window.dispatchEvent(new PageTransitionEvent('pagehide'))
  await expect.element(state).toHaveTextContent('Enabled')
  window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
  await expect.element(state).toHaveTextContent('Paused')
  await userEvent.keyboard('{Escape}')
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
  await expect.element(state).toHaveTextContent('Enabled')
})

it('removes an image whose data cannot be decoded from the available preview actions', async () => {
  await renderGallery(['data:image/png;base64,aW52YWxpZA=='])
  await expect
    .element(page.getByRole('button', { name: 'Preview image 1 of 1' }))
    .not.toBeInTheDocument()
})
