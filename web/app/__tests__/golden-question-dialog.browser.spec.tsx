import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { render } from 'vitest-browser-react'
import { GoldenQuestionDialog } from '@/features/new-rag/quality/golden-question-dialog'

vi.mock('@/service/client', () => ({
  consoleQuery: {
    knowledgeFs: {
      spaces: {
        byControlSpaceId: {
          goldenQuestions: {
            evidenceMatches: {
              post: {
                mutationOptions: () => ({ mutationFn: vi.fn() }),
              },
            },
          },
        },
      },
    },
  },
}))

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
      .element(screen.getByRole('dialog', { name: 'knowledgeSpace.qualityPage.editTitle' }))
      .toBeVisible()
    await screen.getByRole('button', { name: 'knowledgeSpace.qualityPage.closeDialog' }).click()
    await expect
      .element(screen.getByRole('dialog', { name: 'knowledgeSpace.qualityPage.editTitle' }))
      .not.toBeInTheDocument()

    await openButton.click()
    await expect
      .element(screen.getByRole('dialog', { name: 'knowledgeSpace.qualityPage.editTitle' }))
      .toBeVisible()
  })
})
