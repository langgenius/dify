import type {
  GetExploreAppsLearnDifyResponse,
  RecommendedAppResponse,
} from '@dify/contracts/api/console/explore/types.gen'
import type { consoleClient } from '@/service/console'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { render } from 'vitest-browser-react'
import { STEP_BY_STEP_TOUR_TARGETS } from '@/app/components/step-by-step-tour/target-registry'
import explore from '@/i18n/locales/en-US/explore.json'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import LearnDify from '../index'
import { LEARN_DIFY_HIDDEN_STORAGE_KEY } from '../storage'

const getLessons = vi.hoisted(() => vi.fn<typeof consoleClient.explore.apps.learnDify.get>())
vi.unmock('react-i18next')
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'explore.apps.learnDify.get': getLessons,
    }),
  }
})

async function renderLessons(ui: React.ReactElement, enabled = true) {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    keySeparator: false,
    resources: { 'en-US': { explore }, 'pt-BR': { explore } },
  })
  const { wrapper: Providers } = createConsoleQueryWrapper({
    systemFeatures: { enable_learn_app: enabled },
  })
  const wrap = (children: React.ReactElement) => (
    <Providers>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </Providers>
  )
  const screen = await render(wrap(ui))
  return { screen, i18n, rerender: (next: React.ReactElement) => screen.rerender(wrap(next)) }
}

const createApp = (name: string, position: number | null = 1): RecommendedAppResponse => ({
  app_id: name,
  app: { id: name, name, icon_url: null },
  can_trial: false,
  position,
})

beforeEach(() => {
  localStorage.clear()
  getLessons.mockReset().mockResolvedValue({ recommended_apps: [createApp('Learn Dify App')] })
})

it('defers a hidden catalog until the tour forces it visible', async () => {
  localStorage.setItem(LEARN_DIFY_HIDDEN_STORAGE_KEY, 'true')
  const { screen, rerender } = await renderLessons(<LearnDify />)
  await expect.element(screen.getByRole('region', { name: 'Learn Dify' })).not.toBeInTheDocument()
  expect(getLessons).not.toHaveBeenCalled()
  await rerender(<LearnDify forceVisible stepByStepTourTarget={STEP_BY_STEP_TOUR_TARGETS.home} />)
  await expect.element(screen.getByRole('heading', { name: 'Learn Dify App' })).toBeVisible()
  await expect.element(screen.getByRole('button', { name: 'Hide' })).not.toBeInTheDocument()
})

it('keeps the catalog unavailable when its system feature is off, even for a tour', async () => {
  const { screen } = await renderLessons(<LearnDify forceVisible />, false)
  await expect
    .element(screen.getByRole('heading', { name: 'Learn Dify App' }))
    .not.toBeInTheDocument()
  expect(getLessons).not.toHaveBeenCalled()
})

it('orders recommendations before limiting the visible catalog', async () => {
  getLessons.mockResolvedValue({
    recommended_apps: [
      createApp('Last', 5),
      createApp('Null position', null),
      createApp('Zero position', 0),
      createApp('First', -1),
    ],
  } satisfies GetExploreAppsLearnDifyResponse)
  const { screen } = await renderLessons(<LearnDify dismissible={false} itemLimit={3} />)
  await expect.element(screen.getByRole('heading', { name: 'First', exact: true })).toBeVisible()
  expect(
    screen
      .getByRole('heading', { level: 3 })
      .all()
      .map((h) => h.element().textContent),
  ).toEqual(['First', 'Null position', 'Zero position'])
  await expect
    .element(screen.getByRole('heading', { name: 'Last', exact: true }))
    .not.toBeInTheDocument()
})

it('shows the current language catalog and reuses the previous language when switching back', async () => {
  getLessons.mockImplementation(
    async ({
      query,
    }: NonNullable<Parameters<typeof consoleClient.explore.apps.learnDify.get>[0]> = {}) => ({
      recommended_apps: [createApp(query?.language === 'pt-BR' ? 'Português' : 'English')],
    }),
  )
  const { screen, i18n } = await renderLessons(<LearnDify dismissible={false} />)
  await expect.element(screen.getByRole('heading', { name: 'English' })).toBeVisible()
  await i18n.changeLanguage('pt-BR')
  await expect.element(screen.getByRole('heading', { name: 'Português' })).toBeVisible()
  await expect.element(screen.getByRole('heading', { name: 'English' })).not.toBeInTheDocument()
  await i18n.changeLanguage('en-US')
  await expect.element(screen.getByRole('heading', { name: 'English' })).toBeVisible()
  expect(getLessons.mock.calls.map(([input]) => input?.query?.language)).toEqual(['en-US', 'pt-BR'])
})

it('removes its loading message without leaving an empty catalog', async () => {
  const response = createDeferred<GetExploreAppsLearnDifyResponse>()
  getLessons.mockReturnValue(response.promise)
  const { screen } = await renderLessons(
    <LearnDify loadingFallback={<div role="status">Loading lessons</div>} />,
  )
  await expect.element(screen.getByRole('status')).toHaveTextContent('Loading lessons')
  response.resolve({ recommended_apps: [] })
  await expect.element(screen.getByRole('status')).not.toBeInTheDocument()
  await expect.element(screen.getByRole('region', { name: 'Learn Dify' })).not.toBeInTheDocument()
})

beforeEach(() => {
  onTestFinished(guardUnexpectedFetch())
})
