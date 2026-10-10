import type { ExternalKnowledgeBaseHitTesting, HitTesting } from '@/models/datasets'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { ResultItem } from '../result-item'
import { ResultItemExternal } from '../result-item-external'

const { copy } = vi.hoisted(() => ({ copy: vi.fn() }))
vi.mock('foxact/use-clipboard', () => ({
  useClipboard: () => ({ copy, copied: false, reset: vi.fn() }),
}))

// Only syntax highlighting is replaced; Markdown and its copy control stay real.
vi.mock('@/app/components/base/markdown-blocks/shiki-highlight', () => ({
  highlightCode: async ({ code }: { code: string }) => (
    <pre>
      <code>{code}</code>
    </pre>
  ),
}))

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

function withContent(content: string): HitTesting {
  const result = createResult()
  return { ...result, segment: { ...result.segment, content } }
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

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('opens internal details from metadata and footer, preserves fold state and returns focus after exit', async () => {
  vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)
  const screen = await render(
    <ResultItem
      payload={createResult({
        child_chunks: [
          { id: 'child-1', position: 1, score: 0.8, content: 'Matched child content' },
        ],
      })}
    />,
  )
  const footer = screen.getByRole('button', { name: 'datasetHitTesting.open handbook.pdf' })
  const fold = screen.getByRole('button', { name: 'datasetHitTesting.hitChunks:{"num":1}' })
  const dialog = screen.getByRole('dialog', { name: 'datasetHitTesting.chunkDetail' })
  await userEvent.tab()
  await expect.element(fold).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(fold).toHaveAttribute('aria-expanded', 'false')
  await expect.element(screen.getByText('Matched child content')).not.toBeInTheDocument()
  await expect.element(dialog).not.toBeInTheDocument()

  await screen.getByText('Parent-Chunk-01').click()
  const close = dialog.getByRole('button', { name: 'common.operation.close' })
  await expect.element(close).toHaveFocus()
  await expect.element(dialog.getByText('Retrieval preview content')).toBeVisible()
  const popup = dialog.element()
  await expect.poll(() => getComputedStyle(popup).opacity).toBe('1')
  const exit = observeExit(popup)
  await close.click()
  const closing = await exit
  expect(closing.opacity).toBeGreaterThan(0)
  expect(closing.content).toContain('Retrieval preview content')
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(footer).toHaveFocus()
  await expect.element(fold).toHaveAttribute('aria-expanded', 'false')

  await userEvent.keyboard('{Enter}')
  await expect.element(close).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(footer).toHaveFocus()
  await userEvent.tab({ shift: true })
  await userEvent.keyboard(' ')
  await expect.element(fold).toHaveAttribute('aria-expanded', 'true')
  await expect.element(screen.getByText('Matched child content')).toBeVisible()
  await expect.element(dialog).not.toBeInTheDocument()
})

it('leaves real Markdown link, code copy and photo actions independent of parent details', async () => {
  const view = (content: string) => (
    <div className="chat-answer-container">
      <ResultItem payload={withContent(content)} />
      <h2 id="reference">Reference section</h2>
    </div>
  )
  const screen = await render(view('[Read reference](#reference)'))
  const detail = screen.getByRole('dialog', { name: 'datasetHitTesting.chunkDetail' })
  const scroll = vi.spyOn(
    screen.getByRole('heading', { name: 'Reference section' }).element(),
    'scrollIntoView',
  )
  await screen.getByRole('link', { name: 'Read reference' }).click()
  expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth' })
  await expect.element(detail).not.toBeInTheDocument()

  await screen.rerender(view('```text\nCopied retrieval content\n```'))
  await screen.getByRole('button', { name: 'appOverview.overview.appInfo.embedded.copy' }).click()
  expect(copy).toHaveBeenCalledWith('Copied retrieval content')
  await expect.element(detail).not.toBeInTheDocument()

  await screen.rerender(view('![Photo](/logo/logo-site.png)'))
  const photo = screen.getByRole('button', {
    name: 'common.imageGallery.previewImage:{"index":1,"total":1}',
  })
  await photo.click()
  const preview = screen.getByRole('dialog', { name: 'workflow.common.preview' })
  await expect.element(preview).toBeVisible()
  await expect.element(detail).not.toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  await expect.element(preview).not.toBeInTheDocument()
  await expect.element(photo).toHaveFocus()
  await expect.element(detail).not.toBeInTheDocument()
})

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
  await expect.element(thumbnail).toHaveFocus()
  await expect.element(detail).not.toBeInTheDocument()

  const footer = screen.getByRole('button', { name: 'datasetHitTesting.open handbook.pdf' })
  await footer.click()
  const nestedThumbnail = detail.getByRole('button', { name: 'diagram.png' })
  await nestedThumbnail.click()
  await expect.element(preview).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(preview).not.toBeInTheDocument()
  await expect.element(detail).toBeVisible()
  await expect.element(nestedThumbnail).toHaveFocus()
  await userEvent.tab()
  await expect.element(detail.getByRole('button', { name: 'common.operation.close' })).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  await expect.element(detail).not.toBeInTheDocument()
  await expect.element(footer).toHaveFocus()
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
  await expect.element(card).toHaveFocus()
  await userEvent.keyboard(' ')
  await expect.element(dialog.getByText(payload.content)).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(card).toHaveFocus()
})
