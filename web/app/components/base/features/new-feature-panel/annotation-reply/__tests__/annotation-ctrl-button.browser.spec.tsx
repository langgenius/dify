import { useState } from 'react'
import { page } from 'vite-plus/test/browser'
import { AppToaster } from '@/app/notifications/app-toaster'
import { installFakeApi } from '@/test/fake-api'
import { renderFeature } from '../../__tests__/feature-browser-test-env'
import AnnotationCtrlButton from '../annotation-ctrl-button'

// The contract requires a UUID app id.
const appId = '4d5e6f7a-8b9c-4d0e-8f1a-2b3c4d5e6f7a'
const annotationId = '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d'
vi.unmock('react-i18next')

const installApi = () =>
  installFakeApi({
    console: { apps: { byAppId: { annotations: { post: () => ({ id: annotationId }) } } } },
  })
let fake: ReturnType<typeof installApi>
beforeEach(async () => {
  await page.viewport(1100, 800)
  fake = installApi()
  onTestFinished(fake)
})

function Answer({ answer = 'test answer' }: { answer?: string }) {
  const [added, setAdded] = useState('')
  return (
    <>
      <output aria-label="Added annotation">{added}</output>
      <AnnotationCtrlButton
        appId={appId}
        messageId="msg-1"
        query="test query"
        answer={answer}
        onAdded={(id, author) => setAdded(`${id}:${author}`)}
      />
      <AppToaster timeout={0} />
    </>
  )
}

it('creates an annotation from the answer and displays the returned identity and success', async () => {
  const { screen, rerender } = await renderFeature(
    <Answer answer="" />,
    {},
    {
      systemFeatures: { deployment_edition: 'CLOUD' },
      features: { annotation_quota_limit: { size: 5, limit: 100 } },
    },
  )
  await expect
    .element(screen.getByRole('button', { name: 'Add annotation' }))
    .not.toBeInTheDocument()
  await rerender(<Answer />)
  await screen.getByRole('button', { name: 'Add annotation' }).click()
  await expect
    .element(screen.getByRole('status', { name: 'Added annotation' }))
    .toHaveTextContent(`${annotationId}:`)
  await expect.element(screen.getByRole('dialog', { name: 'Action succeeded' })).toBeVisible()
  expect(fake.console.apps.byAppId.annotations.post).toHaveBeenCalledExactlyOnceWith({
    params: { app_id: appId },
    body: { message_id: 'msg-1', question: 'test query', answer: 'test answer' },
  })
})

// https://github.com/langgenius/dify/issues/46103: GridMask intercepts the Close control.
it('opens the real quota modal instead of posting an annotation and restores trigger focus', async () => {
  const { screen } = await renderFeature(
    <Answer />,
    {},
    {
      systemFeatures: { deployment_edition: 'CLOUD' },
      features: { annotation_quota_limit: { size: 100, limit: 100 } },
    },
  )
  const trigger = screen.getByRole('button', { name: 'Add annotation' })
  await trigger.click()
  const dialog = screen.getByRole('dialog')
  await expect.element(dialog.getByText('Upgrade your plan to', { exact: true })).toBeVisible()
  expect(fake.console.apps.byAppId.annotations.post).not.toHaveBeenCalled()
  const close = dialog.getByRole('button', { name: 'Close', exact: true })
  await expect.element(close).toBeVisible()
  const button = close.element()
  const bounds = button.getBoundingClientRect()
  expect(
    button.contains(
      document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2),
    ),
  ).toBe(true)
  await close.click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
})
