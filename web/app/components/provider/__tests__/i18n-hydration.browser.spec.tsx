import type { ReactNode } from 'react'
import { Suspense, useState } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToReadableStream } from 'react-dom/server.browser'
import { useTranslation } from 'react-i18next'
import { page } from 'vite-plus/test/browser'
import { CreateAppDropdown } from '@/app/components/app/create-app-dropdown'
import { I18nClientProvider } from '@/app/components/provider/i18n'
import { serializeResourceUpdate } from '@/i18n/streamed-resources'

vi.mock('react-i18next', async (importOriginal) => await importOriginal())
const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  callbacks: [] as (() => ReactNode)[],
  server: true,
}))
vi.mock('next/navigation', () => ({
  useParams: () => ({}),
  useRouter: () => ({}),
  useServerInsertedHTML: (callback: () => ReactNode) => {
    if (mocks.server) mocks.callbacks.push(callback)
  },
}))
vi.mock('@/i18n/load-resource', () => ({ loadI18nResource: mocks.load }))

function DeferredFeature() {
  const { t } = useTranslation(['login'])
  return <p>{t(($) => $.signBtn)}</p>
}

function FeaturePage() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <CreateAppDropdown onCreateBlank={() => {}} />
      <button onClick={() => setOpen(true)}>Show deferred feature</button>
      {open && <DeferredFeature />}
    </>
  )
}

function executeResourceScript(source: string) {
  const script = document.createElement('script')
  script.textContent = source
  document.head.append(script)
  script.remove()
}

// A real mouse click on SSR markup reproduces the interaction lost when
// client translation loading suspends hydration. No disabled trigger or retry.
it('hydrates the menu from automatically collected SSR resources before the first click', async () => {
  mocks.callbacks = []
  delete window.__difyI18nResources
  const app = { 'newApp.startFromBlank': 'Create from Blank' }
  mocks.load.mockImplementation(async (_locale: string, namespace: string) => ({
    default: namespace === 'common' ? { 'operation.create': 'Create' } : app,
  }))
  const view = (
    <I18nClientProvider locale="en-US" resource={{}}>
      <Suspense fallback={<span>Loading</span>}>
        <FeaturePage />
      </Suspense>
    </I18nClientProvider>
  )
  const stream = await renderToReadableStream(view)
  await stream.allReady
  const html = await new Response(stream).text()
  const inserted = await renderToReadableStream(
    <>{mocks.callbacks.map((callback) => callback())}</>,
  )
  const insertedHTML = await new Response(inserted).text()
  expect(insertedHTML).toContain('Create from Blank')
  expect(insertedHTML).toContain('operation.create')
  const container = document.createElement('div')
  container.innerHTML = html
  document.body.append(container)
  const holder = document.createElement('div')
  holder.innerHTML = insertedHTML
  // innerHTML does not execute scripts; inserting fresh script nodes models
  // the HTML parser executing resource updates before the following content.
  for (const source of holder.querySelectorAll('script')) {
    executeResourceScript(source.textContent ?? '')
  }
  mocks.server = false
  mocks.load.mockClear()
  mocks.load.mockImplementation(() => new Promise(() => {}))
  const root = hydrateRoot(container, view)
  try {
    await page.getByRole('button', { name: 'Create', exact: true }).click()
    await expect.element(page.getByRole('menuitem', { name: 'Create from Blank' })).toBeVisible()
    expect(mocks.load).not.toHaveBeenCalled()
    // A later server flush reaches the already-mounted provider. It must be
    // available before its feature renders, without a second backend request.
    const [id] = Object.keys(window.__difyI18nResources ?? {})
    executeResourceScript(
      serializeResourceUpdate(id!, { 'en-US': { login: { signBtn: 'Sign in' } } }),
    )
    await page.getByRole('button', { name: 'Show deferred feature' }).click()
    await expect.element(page.getByText('Sign in', { exact: true })).toBeVisible()
    expect(mocks.load).not.toHaveBeenCalled()
  } finally {
    root.unmount()
    container.remove()
    delete window.__difyI18nResources
  }
})
