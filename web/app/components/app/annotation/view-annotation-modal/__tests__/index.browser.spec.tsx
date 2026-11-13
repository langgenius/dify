import type { Annotation } from '@dify/contracts/api/console/apps/types.gen'
import type { UserProfileWithMeta } from '@/features/account-profile/client'
import { QueryClient } from '@tanstack/react-query'
import { createInstance } from 'i18next'
import { useState } from 'react'
import { I18nextProvider } from 'react-i18next'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import appAnnotation from '@/i18n/locales/en-US/app-annotation.json'
import appDebug from '@/i18n/locales/en-US/app-debug.json'
import appLog from '@/i18n/locales/en-US/app-log.json'
import common from '@/i18n/locales/en-US/common.json'
import { consoleQuery } from '@/service/console'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { List } from '../../list'

vi.unmock('react-i18next')

// boundary: the test exercises real annotation dialogs while replacing their HTTP mutations.
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
    {
      id: 'first',
      question: 'First question',
      answer: 'First answer',
      created_at: 1704067200,
    },
    {
      id: 'second',
      question: 'Second question',
      answer: 'Second answer',
      created_at: 1704153600,
    },
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

async function renderAnnotations(filterOnEdit = false) {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { appAnnotation, appDebug, appLog, common } },
    keySeparator: false,
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const accountProfile = seedAccountProfileQuery(client)
  client.setQueryData<UserProfileWithMeta>(
    consoleQuery.account.profile.get.queryKey(),
    accountProfile,
  )
  const screen = await render(
    <QueryClientTestProvider queryClient={client}>
      <I18nextProvider i18n={i18n}>
        <AnnotationListFixture filterOnEdit={filterOnEdit} />
      </I18nextProvider>
    </QueryClientTestProvider>,
  )
  return { client, screen }
}

it('returns keyboard focus to the next annotation and then the empty list after nested deletion closes', async () => {
  const { client, screen } = await renderAnnotations()
  await screen.getByRole('button', { name: 'First question' }).click()
  await expect.element(screen.getByText('Created At 01/01/2024 08:00:00 AM')).toBeVisible()
  await screen.getByRole('button', { name: 'Remove this Annotation' }).click()
  await screen.getByRole('button', { name: 'Confirm' }).click()
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('button', { name: 'First question' }))
    .not.toBeInTheDocument()
  const next = screen.getByRole('button', { name: 'Second question' })
  await expect.element(next).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(screen.getByRole('dialog')).toBeVisible()
  await screen.getByRole('button', { name: 'Remove this Annotation' }).click()
  await screen.getByRole('button', { name: 'Confirm' }).click()
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('button', { name: 'Second question' }))
    .not.toBeInTheDocument()
  await expect.element(screen.getByRole('region', { name: 'Annotations' })).toHaveFocus()
  client.clear()
})

it('keeps a second-field draft when saving removes the row from filtered results and restores focus after the save commits', async () => {
  const { client, screen } = await renderAnnotations(true)
  await screen.getByRole('button', { name: 'First question' }).click()
  const question = screen.getByRole('region', { name: 'User Query' })
  const answer = screen.getByRole('region', { name: 'Storyteller Bot' })
  await answer.getByRole('button', { name: 'Edit' }).click()
  const answerInput = answer.getByRole('textbox')
  await answerInput.fill('Unsaved second-field draft')
  const editQuestion = question.getByRole('button', { name: 'Edit' })
  await editQuestion.click()
  await question.getByRole('textbox').fill('Changed question')
  await question.getByRole('button', { name: 'Save' }).click()
  await expect.element(question.getByRole('textbox')).not.toBeInTheDocument()
  await expect.element(editQuestion).toHaveFocus()
  await expect.element(answerInput).toHaveValue('Unsaved second-field draft')
  await expect.element(screen.getByRole('dialog')).toBeVisible()
  await screen.getByRole('button', { name: 'Close' }).click()
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('button', { name: 'First question' }))
    .not.toBeInTheDocument()
  await expect.element(screen.getByRole('region', { name: 'Annotations' })).toHaveFocus()
  client.clear()
})
