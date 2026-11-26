import { useState } from 'react'
import { page } from 'vite-plus/test/browser'
import { AppToaster } from '@/app/notifications/app-toaster'
import { consoleQuery } from '@/service/console'
import { createFeaturesFixture } from '@/test/console/query-data'
import { setupFakeApi } from '@/test/fake-api'
import { createTestQueryClient } from '@/test/query-client'
import { renderFeature } from '../../__tests__/feature-browser-test-env'
import AnnotationCtrlButton from '../annotation-ctrl-button'

// The contract requires a UUID app id.
const appId = '4d5e6f7a-8b9c-4d0e-8f1a-2b3c4d5e6f7a'
const annotationId = '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d'
vi.unmock('react-i18next')

const fake = setupFakeApi(() => ({
  console: {
    apps: { byAppId: { annotations: { post: () => ({ id: annotationId }) } } },
    // Adding an annotation refreshes the quota the button reads.
    features: {
      get: () => createFeaturesFixture({ annotation_quota_limit: { size: 6, limit: 100 } }),
    },
  },
}))
beforeEach(async () => {
  await page.viewport(1100, 800)
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

it('marks the cached annotation list and export stale after adding from the answer', async () => {
  const queryClient = createTestQueryClient()
  const listKey = consoleQuery.apps.byAppId.annotations.get.queryKey({
    input: { params: { app_id: appId }, query: { page: 1, limit: 10, keyword: '' } },
  })
  const exportKey = consoleQuery.apps.byAppId.annotations.export.get.queryKey({
    input: { params: { app_id: appId } },
  })
  queryClient.setQueryData(listKey, { data: [], total: 0, has_more: false, limit: 10, page: 1 })
  queryClient.setQueryData(exportKey, { data: [] })
  const { screen } = await renderFeature(
    <Answer />,
    {},
    {
      queryClient,
      systemFeatures: { deployment_edition: 'CLOUD' },
      features: { annotation_quota_limit: { size: 5, limit: 100 } },
    },
  )
  await screen.getByRole('button', { name: 'Add annotation' }).click()
  await expect
    .element(screen.getByRole('status', { name: 'Added annotation' }))
    .toHaveTextContent(`${annotationId}:`)
  await expect.poll(() => queryClient.getQueryState(listKey)?.isInvalidated).toBe(true)
  expect(queryClient.getQueryState(exportKey)?.isInvalidated).toBe(true)
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
