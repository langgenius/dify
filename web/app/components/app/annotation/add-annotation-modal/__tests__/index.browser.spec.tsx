import type { consoleClient } from '@/service/console'
import { QueryClient } from '@tanstack/react-query'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import appAnnotation from '@/i18n/locales/en-US/app-annotation.json'
import common from '@/i18n/locales/en-US/common.json'
import { seedSystemFeatures } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import AddAnnotationDialog from '../index'

const api = vi.hoisted(() => ({
  add: vi.fn<typeof consoleClient.apps.byAppId.annotations.post>(),
}))

vi.unmock('react-i18next')

// boundary: the test exercises the real annotation owner while replacing its HTTP mutation.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.annotations.post': (input) => api.add(input),
    }),
  }
})

it('resets a continuous-entry form without losing its preference or skipping native required validation', async () => {
  api.add.mockResolvedValue({ id: 'annotation-id' })
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  })
  seedSystemFeatures(client, { deployment_edition: 'COMMUNITY' })
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { appAnnotation, common } },
    keySeparator: false,
  })
  const screen = await render(
    <QueryClientTestProvider queryClient={client}>
      <I18nextProvider i18n={i18n}>
        <AddAnnotationDialog appId="app-id" onAdded={() => {}} />
      </I18nextProvider>
    </QueryClientTestProvider>,
  )
  const trigger = screen.getByRole('button', { name: 'Add Annotation' })
  await trigger.click()
  const dialog = screen.getByRole('dialog', { name: 'Add Annotation Reply' })
  const question = dialog.getByRole('textbox', { name: 'Question' })
  const answer = dialog.getByRole('textbox', { name: 'Answer' })
  const next = dialog.getByRole('checkbox', { name: 'Add another annotated response' })
  const submit = dialog.getByRole('button', { name: 'Add' })

  await question.fill('First question')
  await answer.fill('First answer')
  await next.click()
  await submit.click()
  await expect.element(question).toHaveValue('')
  await expect.element(answer).toHaveValue('')
  await expect.element(question).toHaveFocus()
  await expect.element(next).toBeChecked()

  // Exercise native reset, externally associated submit, and browser constraint validation together.
  await submit.click()
  await expect.element(question).toHaveFocus()
  await expect.element(question).toHaveAttribute('aria-invalid', 'true')
  await expect.element(dialog.getByText('Question is required')).toBeVisible()
  await expect.element(dialog.getByText('Answer is required')).toBeVisible()
  expect(api.add).toHaveBeenCalledOnce()

  await question.fill('Second question')
  await answer.fill('Second answer')
  await next.click()
  await submit.click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  expect(api.add).toHaveBeenLastCalledWith({
    params: { app_id: 'app-id' },
    body: { question: 'Second question', answer: 'Second answer' },
  })
  await userEvent.keyboard('{Enter}')
  await expect.element(question).toHaveValue('')
  await expect.element(answer).toHaveValue('')
  await expect.element(next).not.toBeChecked()
  await expect.element(dialog.getByText('Question is required')).not.toBeInTheDocument()
  client.clear()
})
