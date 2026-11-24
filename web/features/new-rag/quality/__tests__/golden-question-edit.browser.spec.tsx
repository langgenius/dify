import type { KnowledgeFsGoldenQuestionResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import { QueryClientProvider } from '@tanstack/react-query'
import { render } from 'vitest-browser-react'
import { createConsoleQueryClient } from '@/test/console/query-data'
import { hold, setupFakeApi } from '@/test/fake-api'
import { createKnowledgeSpaceFixture, KnowledgeSpaceTestProvider } from '@/test/knowledge-space'
import { GoldenQuestionsPanel } from '../golden-questions-panel'

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

const fake = setupFakeApi({
  console: {
    knowledgeFs: {
      spaces: {
        byControlSpaceId: {
          goldenQuestions: {
            get: () => ({ data: [question], next_cursor: null }),
            byQuestionId: { patch: () => question },
          },
        },
      },
    },
  },
})
const goldenQuestions = () => fake.console.knowledgeFs.spaces.byControlSpaceId.goldenQuestions

it('closes after saving and reopens with the saved value while the list refreshes', async () => {
  const savedQuestion = { ...question, annotation: 'Updated annotation' }
  const { get: listQuestions, byQuestionId } = goldenQuestions()
  listQuestions.mockReturnValueOnce({ data: [question], next_cursor: null })
  const refresh = hold(listQuestions)
  byQuestionId.patch.mockReturnValueOnce(savedQuestion)
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
  await refresh.arrived
  expect(listQuestions).toHaveBeenCalledTimes(2)
  expect(byQuestionId.patch).toHaveBeenCalledExactlyOnceWith({
    params: { control_space_id: 'space-1', question_id: question.id },
    body: {
      annotation: 'Draft annotation',
      evidence_text: '',
      expected_evidence_ids: [],
      match_policy: question.match_policy,
      question: question.question,
      tags: question.tags,
    },
  })

  await actions.click()
  await edit.click()
  await expect.element(annotation).toHaveValue(savedQuestion.annotation)
  refresh.resolve({ data: [savedQuestion], next_cursor: null })
})
