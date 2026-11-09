import type { consoleClient } from '@/service/console'
import { QueryClient } from '@tanstack/react-query'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { seedSystemFeatures } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import AddAnnotationDialog from '../index'

const api = vi.hoisted(() => ({
  add: vi.fn<typeof consoleClient.apps.byAppId.annotations.post>(),
}))

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  return { ...actual, ...createReactI18nextMock() }
})

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
  const screen = await render(
    <QueryClientTestProvider queryClient={client}>
      <AddAnnotationDialog appId="app-id" onAdded={() => {}} />
    </QueryClientTestProvider>,
  )
  const trigger = screen.getByRole('button', { name: 'appAnnotation.table.header.addAnnotation' })
  await trigger.click()
  const dialog = screen.getByRole('dialog', { name: 'appAnnotation.addModal.title' })
  const question = dialog.getByRole('textbox', { name: 'appAnnotation.addModal.queryName' })
  const answer = dialog.getByRole('textbox', { name: 'appAnnotation.addModal.answerName' })
  const next = dialog.getByRole('checkbox', { name: 'appAnnotation.addModal.createNext' })
  const submit = dialog.getByRole('button', { name: 'common.operation.add' })

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
  await expect.element(dialog.getByText('appAnnotation.errorMessage.queryRequired')).toBeVisible()
  await expect.element(dialog.getByText('appAnnotation.errorMessage.answerRequired')).toBeVisible()
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
  await expect
    .element(dialog.getByText('appAnnotation.errorMessage.queryRequired'))
    .not.toBeInTheDocument()
  client.clear()
})
