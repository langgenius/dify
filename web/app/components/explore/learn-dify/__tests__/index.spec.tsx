import type {
  GetExploreAppsLearnDifyResponse,
  RecommendedAppResponse,
} from '@dify/contracts/api/console/explore/types.gen'
import { act, screen, waitFor } from '@testing-library/react'
import { STEP_BY_STEP_TOUR_TARGETS } from '@/app/components/step-by-step-tour/target-registry'
import { consoleQuery } from '@/service/console'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import LearnDify from '../index'
import { LEARN_DIFY_HIDDEN_STORAGE_KEY } from '../storage'

const { request, locale } = vi.hoisted(() => ({
  request: vi.fn(),
  locale: { value: 'en-US' },
}))
vi.mock('@/service/base', () => ({ request }))
vi.mock('#i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#i18n')>()),
  useLocale: () => locale.value,
}))

const createApp = (name: string, position: number | null = 1): RecommendedAppResponse => ({
  app_id: name,
  app: { id: name, name, icon_url: null },
  can_trial: false,
  position,
})

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  locale.value = 'en-US'
  request.mockImplementation(async () =>
    Response.json({ recommended_apps: [createApp('Learn Dify App')] }),
  )
})

describe('Learn Dify catalog', () => {
  it('does not fetch hidden content until the step tour forces it visible', async () => {
    localStorage.setItem(LEARN_DIFY_HIDDEN_STORAGE_KEY, 'true')
    const { rerender } = render(<LearnDify />, {
      systemFeatures: { enable_learn_app: true },
    })

    expect(
      screen.queryByRole('heading', { name: 'explore.learnDify.title' }),
    ).not.toBeInTheDocument()
    expect(request).not.toHaveBeenCalled()
    rerender(<LearnDify forceVisible stepByStepTourTarget={STEP_BY_STEP_TOUR_TARGETS.home} />)

    const section = await screen.findByRole('region', { name: 'explore.learnDify.title' })
    expect(section).toHaveAttribute('data-step-by-step-tour-target', STEP_BY_STEP_TOUR_TARGETS.home)
    expect(screen.queryByRole('button', { name: 'explore.learnDify.hide' })).not.toBeInTheDocument()
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('does not fetch when the system feature is disabled, even if visibility is forced', () => {
    render(<LearnDify forceVisible />, { systemFeatures: { enable_learn_app: false } })

    expect(
      screen.queryByRole('heading', { name: 'explore.learnDify.title' }),
    ).not.toBeInTheDocument()
    expect(request).not.toHaveBeenCalled()
  })

  it('sorts before limiting visible items while retaining the raw response in the generated cache', async () => {
    const response: GetExploreAppsLearnDifyResponse = {
      recommended_apps: [
        createApp('Last', 5),
        createApp('Null position', null),
        createApp('Zero position', 0),
        createApp('First', -1),
      ],
    }
    request.mockImplementation(async () => Response.json(response))
    const { queryClient } = render(<LearnDify dismissible={false} itemLimit={3} />, {
      systemFeatures: { enable_learn_app: true },
    })

    await screen.findByRole('heading', { name: 'First' })
    expect(
      screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent),
    ).toEqual(['First', 'Null position', 'Zero position'])
    expect(screen.queryByRole('heading', { name: 'Last' })).not.toBeInTheDocument()
    const cached = queryClient.getQueryData(
      consoleQuery.explore.apps.learnDify.get.queryOptions({
        input: { query: { language: 'en-US' } },
      }).queryKey,
    )
    expect(cached).toEqual(response)
  })

  it('keeps each requested locale in its own generated cache entry', async () => {
    const requestedLocales: Array<string | null> = []
    request.mockImplementation(async (url: string) => {
      const language = new URL(url).searchParams.get('language')
      requestedLocales.push(language)
      return Response.json({
        recommended_apps: [createApp(language === 'pt-BR' ? 'Português' : 'English')],
      })
    })
    const { rerender } = render(<LearnDify dismissible={false} title="English catalog" />, {
      systemFeatures: { enable_learn_app: true },
    })
    expect(await screen.findByRole('heading', { name: 'English' })).toBeInTheDocument()

    locale.value = 'pt-BR'
    rerender(<LearnDify dismissible={false} title="Portuguese catalog" />)
    expect(await screen.findByRole('heading', { name: 'Português' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'English' })).not.toBeInTheDocument()

    locale.value = 'en-US'
    rerender(<LearnDify dismissible={false} title="English catalog" />)
    expect(await screen.findByRole('heading', { name: 'English' })).toBeInTheDocument()
    expect(requestedLocales).toEqual(['en-US', 'pt-BR'])
  })

  it('shows the supplied loading fallback until the request resolves, then leaves an empty catalog hidden', async () => {
    let resolveResponse!: (response: Response) => void
    request.mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveResponse = resolve
      }),
    )
    render(<LearnDify loadingFallback={<div role="status">Loading lessons</div>} />, {
      systemFeatures: { enable_learn_app: true },
    })

    expect(screen.getByRole('status')).toHaveTextContent('Loading lessons')
    await act(async () => resolveResponse(Response.json({ recommended_apps: [] })))
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    expect(
      screen.queryByRole('heading', { name: 'explore.learnDify.title' }),
    ).not.toBeInTheDocument()
  })
})
