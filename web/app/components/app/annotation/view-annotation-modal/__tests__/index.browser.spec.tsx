import type { Annotation } from '@dify/contracts/api/console/apps/types.gen'
import { QueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { List } from '../../list'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  return { ...actual, ...createReactI18nextMock() }
})
vi.mock('@/hooks/use-timestamp', () => ({ default: () => ({ formatTime: () => 'Created time' }) }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.annotations.byAnnotationId.delete': () => undefined,
      'apps.byAppId.annotations.byAnnotationId.post': () => undefined,
    }),
  }
})

function AnnotationListFixture({ filterOnEdit = false }: { filterOnEdit?: boolean }) {
  const [items, setItems] = useState<Annotation[]>([
    { id: 'first', question: 'First question', answer: 'First answer' },
    { id: 'second', question: 'Second question', answer: 'Second answer' },
  ])
  return (
    <List
      appId="app-id"
      list={items}
      onEdited={() => {
        if (filterOnEdit) setItems([])
      }}
      onRemoved={() => setItems(items.slice(1))}
      selectedIds={[]}
      onSelectedIdsChange={() => {}}
      onBatchDelete={async () => {}}
    />
  )
}

it('returns keyboard focus to the next annotation and then the empty list after nested deletion closes', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const screen = await render(
    <QueryClientTestProvider queryClient={client}>
      <AnnotationListFixture />
    </QueryClientTestProvider>,
  )
  await screen.getByRole('button', { name: 'First question' }).click()
  await screen.getByRole('button', { name: 'appAnnotation.editModal.removeThisCache' }).click()
  await screen.getByRole('button', { name: 'common.operation.confirm' }).click()
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('button', { name: 'First question' }))
    .not.toBeInTheDocument()
  const next = screen.getByRole('button', { name: 'Second question' })
  await expect.element(next).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(screen.getByRole('dialog')).toBeVisible()
  await screen.getByRole('button', { name: 'appAnnotation.editModal.removeThisCache' }).click()
  await screen.getByRole('button', { name: 'common.operation.confirm' }).click()
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('button', { name: 'Second question' }))
    .not.toBeInTheDocument()
  await expect.element(screen.getByRole('region', { name: 'appAnnotation.title' })).toHaveFocus()
  client.clear()
})

it('keeps a second-field draft when saving removes the row from filtered results and restores focus after the save commits', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const screen = await render(
    <QueryClientTestProvider queryClient={client}>
      <AnnotationListFixture filterOnEdit />
    </QueryClientTestProvider>,
  )
  await screen.getByRole('button', { name: 'First question' }).click()
  const question = screen.getByRole('region', { name: 'appAnnotation.editModal.queryName' })
  const answer = screen.getByRole('region', { name: 'appAnnotation.editModal.answerName' })
  await answer.getByRole('button', { name: 'common.operation.edit' }).click()
  const answerInput = answer.getByRole('textbox')
  await answerInput.fill('Unsaved second-field draft')
  const editQuestion = question.getByRole('button', { name: 'common.operation.edit' })
  await editQuestion.click()
  await question.getByRole('textbox').fill('Changed question')
  await question.getByRole('button', { name: 'common.operation.save' }).click()
  await expect.element(question.getByRole('textbox')).not.toBeInTheDocument()
  await expect.element(editQuestion).toHaveFocus()
  await expect.element(answerInput).toHaveValue('Unsaved second-field draft')
  await expect.element(screen.getByRole('dialog')).toBeVisible()
  await screen.getByRole('button', { name: 'common.operation.close' }).click()
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('button', { name: 'First question' }))
    .not.toBeInTheDocument()
  await expect.element(screen.getByRole('region', { name: 'appAnnotation.title' })).toHaveFocus()
  client.clear()
})
