import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { GoldenQuestionDialog } from '@/features/new-rag/quality/golden-question-dialog'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'

function DialogHarness() {
  const [open, setOpen] = useState(false)
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          mutations: { retry: false },
          queries: { retry: false },
        },
      }),
  )

  return (
    <QueryClientProvider client={queryClient}>
      <button type="button" onClick={() => setOpen(true)}>
        Open dialog
      </button>
      <GoldenQuestionDialog
        initialValue={{
          annotation: '',
          expectedEvidenceIds: [],
          matchPolicy: 'all',
          question: 'What is the refund policy?',
          tags: [],
        }}
        knowledgeSpaceId="space-1"
        mode="edit"
        open={open}
        onOpenChange={setOpen}
        onSubmit={vi.fn()}
      />
    </QueryClientProvider>
  )
}

describe('GoldenQuestionDialog browser interactions', () => {
  it('releases page pointer interactions after closing', async () => {
    // Chromium owns overlay hit testing and Base UI's transition cleanup.
    const screen = await render(<DialogHarness />)
    const openButton = screen.getByRole('button', { name: 'Open dialog' })

    await openButton.click()
    await expect
      .element(screen.getByRole('dialog', { name: 'knowledgeQuality.qualityPage.editTitle' }))
      .toBeVisible()
    await screen.getByRole('button', { name: 'knowledgeQuality.qualityPage.closeDialog' }).click()
    await expect
      .element(screen.getByRole('dialog', { name: 'knowledgeQuality.qualityPage.editTitle' }))
      .not.toBeInTheDocument()

    await openButton.click()
    await expect
      .element(screen.getByRole('dialog', { name: 'knowledgeQuality.qualityPage.editTitle' }))
      .toBeVisible()
  })

  it('keeps the draft open when the backdrop is pressed', async () => {
    const screen = await render(<DialogHarness />)

    await screen.getByRole('button', { name: 'Open dialog' }).click()
    const question = screen.getByPlaceholder('knowledgeQuality.qualityPage.questionPlaceholder')
    await question.fill('Edited draft question')
    // The backdrop has no accessible role, so press the page corner it covers. `force` only skips
    // the actionability check; the real mouse event still hit-tests onto the backdrop.
    await userEvent.click(document.body, { force: true, position: { x: 4, y: 4 } })

    await expect
      .element(screen.getByRole('dialog', { name: 'knowledgeQuality.qualityPage.editTitle' }))
      .toBeVisible()
    await expect.element(question).toHaveValue('Edited draft question')
  })
})

beforeEach(() => {
  onTestFinished(guardUnexpectedFetch())
})
