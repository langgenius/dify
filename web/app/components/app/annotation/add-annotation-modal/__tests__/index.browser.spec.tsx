import { QueryClient } from '@tanstack/react-query'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import appAnnotation from '@/i18n/locales/en-US/app-annotation.json'
import common from '@/i18n/locales/en-US/common.json'
import { seedFeatures } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { installFakeApi } from '@/test/fake-api'
import AddAnnotationDialog from '../index'

const appId = '019a0000-0000-7000-8000-000000000001'

vi.unmock('react-i18next')

it('resets a continuous-entry form without losing its preference or skipping native required validation', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  })
  const features = seedFeatures(client, { annotation_quota_limit: { size: 0, limit: 0 } })
  const fake = installFakeApi({
    console: {
      apps: {
        byAppId: {
          annotations: { post: () => ({ id: '019a0000-0000-7000-8000-000000000002' }) },
        },
      },
      // Adding an annotation refreshes the quota the dialog reads.
      features: { get: () => features },
    },
  })
  onTestFinished(fake)
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { appAnnotation, common } },
    keySeparator: false,
  })
  const screen = await render(
    <QueryClientTestProvider queryClient={client}>
      <I18nextProvider i18n={i18n}>
        <AddAnnotationDialog appId={appId} onAdded={() => {}} />
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
  expect(fake.console.apps.byAppId.annotations.post).toHaveBeenCalledOnce()

  await question.fill('Second question')
  await answer.fill('Second answer')
  await next.click()
  await submit.click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  expect(fake.console.apps.byAppId.annotations.post).toHaveBeenLastCalledWith(
    expect.objectContaining({
      params: { app_id: appId },
      body: { question: 'Second question', answer: 'Second answer' },
    }),
  )
  await userEvent.keyboard('{Enter}')
  await expect.element(question).toHaveValue('')
  await expect.element(answer).toHaveValue('')
  await expect.element(next).not.toBeChecked()
  await expect.element(dialog.getByText('Question is required')).not.toBeInTheDocument()
  client.clear()
})
