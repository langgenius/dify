import type {
  KnowledgeFsGoldenQuestionListResponse,
  KnowledgeFsGoldenQuestionResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import { QueryClientProvider } from '@tanstack/react-query'
import { render } from 'vitest-browser-react'
import { createConsoleQueryClient } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createKnowledgeSpaceFixture, KnowledgeSpaceTestProvider } from '@/test/knowledge-space'
import { GoldenQuestionsPanel } from '../golden-questions-panel'

const { listQuestions, saveQuestion } = vi.hoisted(() => ({
  listQuestions: vi.fn(),
  saveQuestion: vi.fn(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'knowledgeFs.spaces.byControlSpaceId.goldenQuestions.get': listQuestions,
      'knowledgeFs.spaces.byControlSpaceId.goldenQuestions.byQuestionId.patch': saveQuestion,
    }),
  }
})

const question = {
  annotation: 'Original annotation',
  created_at: '2026-07-28T00:00:00Z',
  id: 'golden-1',
  match_policy: 'all',
  question: 'What is the refund policy?',
  status: 'active',
  tags: ['billing'],
  updated_at: '2026-07-28T00:00:00Z',
} satisfies KnowledgeFsGoldenQuestionResponse

it('closes after saving and reopens with the saved value while the list refreshes', async () => {
  const refresh = createDeferred<KnowledgeFsGoldenQuestionListResponse>()
  const savedQuestion = { ...question, annotation: 'Updated annotation' }
  onTestFinished(() => refresh.resolve({ data: [savedQuestion], next_cursor: null }))
  listQuestions.mockResolvedValueOnce({ data: [question], next_cursor: null })
  listQuestions.mockReturnValueOnce(refresh.promise)
  saveQuestion.mockResolvedValueOnce(savedQuestion)
  const client = createConsoleQueryClient()
  onTestFinished(() => client.clear())
  const screen = await render(
    <QueryClientProvider client={client}>
      <KnowledgeSpaceTestProvider
        space={createKnowledgeSpaceFixture({ permission_keys: ['knowledge_space_edit'] })}
      >
        <GoldenQuestionsPanel actionSlot={null} />
      </KnowledgeSpaceTestProvider>
    </QueryClientProvider>,
  )
  const actions = screen.getByRole('button', {
    name: /knowledgeQuality\.qualityPage\.questionActions/,
  })
  const edit = screen.getByRole('menuitem', { name: 'knowledgeQuality.qualityPage.edit' })
  const dialog = screen.getByRole('dialog', { name: 'knowledgeQuality.qualityPage.editTitle' })
  const annotation = dialog.getByPlaceholder('knowledgeQuality.qualityPage.annotationPlaceholder')

  await actions.click()
  await edit.click()
  await annotation.fill('Draft annotation')
  await dialog.getByRole('button', { name: 'knowledgeQuality.qualityPage.save' }).click()

  await expect.element(dialog).not.toBeInTheDocument()
  expect(listQuestions).toHaveBeenCalledTimes(2)

  await actions.click()
  await edit.click()
  await expect.element(annotation).toHaveValue(savedQuestion.annotation)
})
