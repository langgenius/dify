import { useState } from 'react'
import { page } from 'vite-plus/test/browser'
import { AppToaster } from '@/app/notifications/app-toaster'
import { ModalContextProvider } from '@/context/modal-context-provider'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { renderFeature } from '../../__tests__/feature-browser-test-env'
import AnnotationCtrlButton from '../annotation-ctrl-button'

const api = vi.hoisted(() => ({ addAnnotation: vi.fn() }))
vi.unmock('react-i18next')
// boundary: annotation creation is a generated Console HTTP request.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'apps.byAppId.annotations.post': api.addAnnotation,
    }),
  }
})

beforeEach(async () => {
  await page.viewport(1100, 800)
  onTestFinished(guardUnexpectedFetch())
  api.addAnnotation.mockResolvedValue({ id: 'annotation-1' })
})

function Answer({ answer = 'test answer' }: { answer?: string }) {
  const [added, setAdded] = useState('')
  return (
    <>
      <output aria-label="Added annotation">{added}</output>
      <AnnotationCtrlButton
        appId="test-app"
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
    .toHaveTextContent('annotation-1:')
  await expect.element(screen.getByRole('dialog', { name: 'Action succeeded' })).toBeVisible()
  expect(api.addAnnotation).toHaveBeenCalledExactlyOnceWith({
    params: { app_id: 'test-app' },
    body: { message_id: 'msg-1', question: 'test query', answer: 'test answer' },
  })
})

// https://github.com/langgenius/dify/issues/46103: GridMask intercepts the Close control.
it.fails('opens the real quota modal instead of posting an annotation and restores trigger focus', async () => {
  const { screen } = await renderFeature(
    <ModalContextProvider>
      <Answer />
    </ModalContextProvider>,
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
  expect(api.addAnnotation).not.toHaveBeenCalled()
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
