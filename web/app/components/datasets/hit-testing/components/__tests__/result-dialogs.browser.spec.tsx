import type { ExternalKnowledgeBaseHitTesting, HitTesting } from '@/models/datasets'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { ResultItem } from '../result-item'
import { ResultItemExternal } from '../result-item-external'

function createResult(overrides: Partial<HitTesting> = {}): HitTesting {
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
    files: [],
    ...overrides,
  }
}

function createImageUrl() {
  const canvas = document.createElement('canvas')
  canvas.width = 80
  canvas.height = 60
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas context unavailable')
  context.fillStyle = 'green'
  context.fillRect(0, 0, 80, 60)
  return canvas.toDataURL('image/png')
}

function observeExit(popup: Element) {
  return new Promise<{ opacity: number; content: string | null }>((resolve) => {
    const onTransition = (event: Event) => {
      if (event.target !== popup || (event as TransitionEvent).propertyName !== 'opacity') return
      popup.removeEventListener('transitionrun', onTransition)
      resolve({ opacity: Number(getComputedStyle(popup).opacity), content: popup.textContent })
    }
    popup.addEventListener('transitionrun', onTransition)
  })
}

beforeEach(async () => {
  await page.viewport(1280, 900)
})

afterEach(() => vi.unstubAllGlobals())

it('opens attachments independently and nests their preview only while details are open', async () => {
  const screen = await render(
    <ResultItem
      payload={createResult({
        files: [
          {
            id: 'image-1',
            name: 'diagram.png',
            size: 128,
            extension: 'png',
            mime_type: 'image/png',
            source_url: createImageUrl(),
          },
        ],
      })}
    />,
  )
  const thumbnail = screen.getByRole('button', { name: 'diagram.png' })
  const detail = screen.getByRole('dialog', { name: 'datasetHitTesting.chunkDetail' })
  const preview = screen.getByRole('dialog', { name: 'diagram.png' })
  await thumbnail.click()
  await expect.element(preview).toBeVisible()
  await expect.element(detail).not.toBeInTheDocument()
  await preview.getByRole('button', { name: 'common.operation.close' }).click()
  await expect.element(preview).not.toBeInTheDocument()
  await expect.element(detail).not.toBeInTheDocument()

  await screen.getByRole('button', { name: 'datasetHitTesting.open handbook.pdf' }).click()
  const nestedThumbnail = detail.getByRole('button', { name: 'diagram.png' })
  await nestedThumbnail.click()
  await expect.element(preview).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(preview).not.toBeInTheDocument()
  await expect.element(detail).toBeVisible()
})

it('keeps external details scrollable and Close reachable on a narrow viewport through keyboard and exit', async () => {
  await page.viewport(414, 900)
  vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
  const payload: ExternalKnowledgeBaseHitTesting = {
    title: 'External handbook',
    content: `${'External retrieval content. '.repeat(200)}${'unbroken'.repeat(60)}`,
    score: 0.85,
    metadata: {
      'x-amz-bedrock-kb-source-uri': 's3://handbook',
      'x-amz-bedrock-kb-data-source-id': 'source-1',
    },
  }
  const screen = await render(<ResultItemExternal payload={payload} positionId={1} />)
  const card = screen.getByRole('button', { name: 'datasetHitTesting.open External handbook' })
  await userEvent.tab()
  await expect.element(card).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  const dialog = screen.getByRole('dialog', { name: 'datasetHitTesting.chunkDetail' })
  const close = dialog.getByRole('button', { name: 'common.operation.close' })
  await expect.element(close).toHaveFocus()
  const popup = dialog.element()
  await expect.poll(() => getComputedStyle(popup).opacity).toBe('1')
  const popupBounds = popup.getBoundingClientRect()
  const closeBounds = close.element().getBoundingClientRect()
  expect(popupBounds.left).toBeGreaterThanOrEqual(0)
  expect(popupBounds.right).toBeLessThanOrEqual(window.innerWidth)
  expect(closeBounds.left).toBeGreaterThanOrEqual(0)
  expect(closeBounds.right).toBeLessThanOrEqual(window.innerWidth)
  expect(closeBounds.top).toBeGreaterThanOrEqual(0)
  expect(closeBounds.bottom).toBeLessThanOrEqual(window.innerHeight)
  const body = dialog.getByText(payload.content)
  const bodyElement = body.element()
  expect(bodyElement.scrollWidth).toBeLessThanOrEqual(bodyElement.clientWidth + 1)
  expect(bodyElement.scrollHeight).toBeGreaterThan(bodyElement.clientHeight)
  await body.wheel({ delta: { y: 600 } })
  await expect.poll(() => bodyElement.scrollTop).toBeGreaterThan(0)
  const exit = observeExit(popup)
  await close.click()
  const closing = await exit
  expect(closing.opacity).toBeGreaterThan(0)
  expect(closing.content).toContain(payload.content)
  await expect.element(dialog).not.toBeInTheDocument()
})
