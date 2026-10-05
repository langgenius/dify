import type { ComponentProps } from 'react'
import type { FileUploadConfigResponse } from '@/models/common'
import type { HitTesting } from '@/models/datasets'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { commonQueryKeys } from '@/service/use-common'
import { ResultItem } from '../../../hit-testing/components/result-item'
import { ImageList } from '../../image-list'
import { ImageUploaderInChunk } from '../../image-uploader/image-uploader-in-chunk'
import { ImageUploaderInRetrievalTesting } from '../../image-uploader/image-uploader-in-retrieval-testing'

type GalleryImage = ComponentProps<typeof ImageList>['images'][number]

function createImage(name: string, color: string): GalleryImage {
  const canvas = document.createElement('canvas')
  canvas.width = 80
  canvas.height = 60
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas context unavailable')
  context.fillStyle = color
  context.fillRect(0, 0, canvas.width, canvas.height)
  return {
    name,
    mimeType: 'image/png',
    sourceUrl: canvas.toDataURL('image/png'),
    size: 128,
    extension: 'png',
  }
}

function createResult(image: GalleryImage): HitTesting {
  const segment: HitTesting['segment'] = {
    id: 'segment-1',
    document: {
      id: 'document-1',
      name: 'handbook.pdf',
      data_source_type: 'upload_file',
      doc_type: 'book',
    },
    content: 'Retrieval preview content',
    sign_content: '',
    position: 1,
    word_count: 25,
    tokens: 5,
    keywords: [],
    hit_count: 1,
    index_node_hash: 'hash',
    answer: '',
  }
  return {
    segment,
    content: segment,
    score: 0.9,
    tsne_position: { x: 0, y: 0 },
    child_chunks: [],
    files: [
      {
        id: 'image-1',
        name: image.name,
        source_url: image.sourceUrl,
        mime_type: image.mimeType,
        size: image.size,
        extension: image.extension,
      },
    ],
  }
}

beforeEach(async () => {
  await page.viewport(1280, 900)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('isolates galleries, snapshots the clicked list and starts the clicked image again on a quick reopen', async () => {
  vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
  const red = createImage('red.png', 'red')
  const blue = createImage('blue.png', 'blue')
  const green = createImage('green.png', 'green')
  const view = (firstImages: GalleryImage[]) => (
    <>
      <section aria-label="First gallery">
        <ImageList images={firstImages} size="md" />
      </section>
      <section aria-label="Second gallery">
        <ImageList images={[green]} size="md" />
      </section>
    </>
  )
  const screen = await render(view([red, blue]))
  const first = screen.getByRole('region', { name: 'First gallery' })
  const blueEntry = first.getByRole('button', { name: 'blue.png' })
  await blueEntry.click()
  let preview = screen.getByRole('dialog', { name: 'blue.png' })
  const blueImage = preview.getByRole('img', { name: 'blue.png' })
  await expect.poll(() => (blueImage.element() as HTMLImageElement).naturalWidth).toBe(80)
  await expect
    .element(preview.getByRole('button', { name: 'common.pagination.next' }))
    .toBeDisabled()
  await screen.rerender(view([blue, red, green]))
  await expect
    .element(preview.getByRole('button', { name: 'common.pagination.next' }))
    .toBeDisabled()
  await userEvent.keyboard('{ArrowLeft}')
  preview = screen.getByRole('dialog', { name: 'red.png' })
  await expect.element(preview.getByRole('img', { name: 'red.png' })).toBeVisible()
  const popup = preview.element()
  await expect.poll(() => getComputedStyle(popup).opacity).toBe('1')
  const exitFrame = new Promise<boolean>((resolve) => {
    const onTransition = (event: Event) => {
      if (event.target !== popup || (event as TransitionEvent).propertyName !== 'opacity') return
      popup.removeEventListener('transitionrun', onTransition)
      resolve(popup.isConnected && Number(getComputedStyle(popup).opacity) > 0)
    }
    popup.addEventListener('transitionrun', onTransition)
  })
  await preview.getByRole('button', { name: 'common.operation.close' }).click()
  expect(await exitFrame).toBe(true)
  await expect.element(blueEntry).toHaveFocus()
  expect(popup.isConnected).toBe(false)
  await userEvent.keyboard(' ')
  preview = screen.getByRole('dialog', { name: 'blue.png' })
  await expect.element(preview.getByRole('img', { name: 'blue.png' })).toBeVisible()
  await expect
    .element(preview.getByRole('button', { name: 'common.pagination.previous' }))
    .toBeDisabled()
  await userEvent.keyboard('{Escape}')
  await expect.element(preview).not.toBeInTheDocument()
  await expect.element(blueEntry).toHaveFocus()

  const second = screen.getByRole('region', { name: 'Second gallery' })
  const greenEntry = second.getByRole('button', { name: 'green.png' })
  await userEvent.tab()
  await userEvent.tab()
  await userEvent.tab()
  await expect.element(greenEntry).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  const greenPreview = screen.getByRole('dialog', { name: 'green.png' })
  await expect.element(greenPreview.getByRole('img', { name: 'green.png' })).toBeVisible()
  await expect
    .element(greenPreview.getByRole('button', { name: 'common.pagination.previous' }))
    .toBeDisabled()
  await expect
    .element(greenPreview.getByRole('button', { name: 'common.pagination.next' }))
    .toBeDisabled()
  await greenPreview.getByRole('button', { name: 'common.operation.close' }).click()
  await expect.element(greenPreview).not.toBeInTheDocument()
  await expect.element(greenEntry).toHaveFocus()
})

it('retries a real image decoding error and keeps Close available', async () => {
  const broken = { ...createImage('broken.png', 'red'), sourceUrl: 'data:image/png;base64,AAAA' }
  let failures = 0
  const onError = (event: Event) => {
    if (event.target instanceof HTMLImageElement && event.target.src === broken.sourceUrl)
      failures += 1
  }
  document.addEventListener('error', onError, true)
  try {
    const screen = await render(<ImageList images={[broken]} size="md" />)
    const trigger = screen.getByRole('button', { name: 'broken.png' })
    await trigger.click()
    const preview = screen.getByRole('dialog', { name: 'broken.png' })
    const close = preview.getByRole('button', { name: 'common.operation.close' })
    const originalClose = close.element()
    await expect
      .element(preview.getByText('common.imageUploader.uploadFromComputerReadError'))
      .toBeVisible()
    const initialFailures = failures
    await preview.getByRole('button', { name: 'common.operation.retry' }).click()
    await expect.poll(() => failures).toBeGreaterThan(initialFailures)
    await expect
      .element(preview.getByText('common.imageUploader.uploadFromComputerReadError'))
      .toBeVisible()
    expect(close.element()).toBe(originalClose)
    await userEvent.tab()
    expect(preview.element().contains(document.activeElement)).toBe(true)
    await userEvent.keyboard('{Escape}')
    await expect.element(preview).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
  } finally {
    document.removeEventListener('error', onError, true)
  }
})

it('reaches uploader removal by keyboard and previews a read-only failed upload by pointer', async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
  queryClient.setQueryData<FileUploadConfigResponse>(commonQueryKeys.fileUploadConfig, {
    batch_count_limit: 10,
    image_file_batch_limit: 10,
    single_chunk_attachment_limit: 10,
    attachment_image_file_size_limit: 2,
    file_size_limit: 15,
    file_upload_limit: 5,
  })
  const uploaded = { ...createImage('uploaded.png', 'green'), id: 'uploaded', progress: 100 }
  const failed = { ...createImage('failed.png', 'blue'), id: 'failed', progress: -1 }
  const onChunkChange = vi.fn()
  const onRetrievalChange = vi.fn()
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <section aria-label="Chunk uploader">
        <ImageUploaderInChunk value={[uploaded]} onChange={onChunkChange} />
      </section>
      <section aria-label="Retrieval uploader">
        <ImageUploaderInRetrievalTesting
          value={[uploaded]}
          onChange={onRetrievalChange}
          textArea={null}
          actionButton={null}
        />
      </section>
      <section aria-label="Read-only uploader">
        <ImageUploaderInChunk value={[failed]} onChange={vi.fn()} disabled />
      </section>
    </QueryClientProvider>,
  )
  for (const [name, onChange] of [
    ['Chunk uploader', onChunkChange],
    ['Retrieval uploader', onRetrievalChange],
  ] as const) {
    const region = screen.getByRole('region', { name })
    const thumbnail = region.getByRole('button', { name: 'uploaded.png' })
    await thumbnail.click()
    await userEvent.keyboard('{Escape}')
    await expect.element(thumbnail).toHaveFocus()
    await userEvent.tab()
    const remove = region.getByRole('button', { name: 'common.operation.remove' })
    await expect.element(remove).toHaveFocus()
    await expect.element(remove).toBeVisible()
    await userEvent.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledWith([])
    await expect.element(thumbnail).not.toBeInTheDocument()
  }
  const readonly = screen.getByRole('region', { name: 'Read-only uploader' })
  const failedThumbnail = readonly.getByRole('button', { name: 'failed.png' })
  await expect
    .element(readonly.getByRole('button', { name: 'common.operation.retry' }))
    .toBeDisabled()
  await failedThumbnail.click()
  const preview = screen.getByRole('dialog', { name: 'failed.png' })
  await expect.element(preview.getByRole('img', { name: 'failed.png' })).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(preview).not.toBeInTheDocument()
  await expect.element(failedThumbnail).toHaveFocus()
  queryClient.clear()
})

it('closes the nested image, its restored thumbnail tooltip and the parent details in order', async () => {
  const screen = await render(
    <ResultItem payload={createResult(createImage('diagram.png', 'green'))} />,
  )
  const footer = screen.getByRole('button', { name: 'datasetHitTesting.open handbook.pdf' })
  await footer.click()
  const details = screen.getByRole('dialog', { name: 'datasetHitTesting.chunkDetail' })
  const thumbnail = details.getByRole('button', { name: 'diagram.png' })
  await thumbnail.click()
  const preview = screen.getByRole('dialog', { name: 'diagram.png' })
  await expect.element(preview.getByRole('img', { name: 'diagram.png' })).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(preview).not.toBeInTheDocument()
  await expect.element(thumbnail).toHaveFocus()
  const tooltip = screen.getByText('diagram.png')
  await expect.element(tooltip).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(tooltip).not.toBeInTheDocument()
  await expect.element(details).toBeVisible()
  await expect.element(thumbnail).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  await expect.element(details).not.toBeInTheDocument()
  await expect.element(footer).toHaveFocus()
})
