import type { CloudSandboxPlanState } from '../cloud-sandbox-retention'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import dayjs from 'dayjs'
import { APP_PAGE_LIMIT } from '@/config'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { runDebouncedUserInteraction } from '@/test/debounce'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { createReactI18nextMock } from '@/test/i18n-mock'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import Logs from '../index'

const render = (ui: React.ReactElement, searchParams = '') => {
  const { wrapper: UrlState, onUrlUpdate } = createNuqsTestWrapper({
    searchParams,
    hasMemory: true,
  })
  return { ...renderWithConsoleQuery(<UrlState>{ui}</UrlState>), onUrlUpdate }
}

vi.mock('react-i18next', () => {
  const mock = createReactI18nextMock()
  return {
    ...mock,
    useTranslation: (...args: Parameters<typeof mock.useTranslation>) => ({
      ...mock.useTranslation(...args),
      ready: true,
    }),
  }
})

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.example.com${path}`,
}))

const getChatConversations = vi.fn()
const getCompletionConversations = vi.fn()
const mockPlanState = vi.hoisted(() => ({
  value: 'unrestricted' as CloudSandboxPlanState,
}))

vi.mock('../cloud-sandbox-retention', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../cloud-sandbox-retention')>()
  return {
    ...actual,
    useCloudSandboxPlanStatus: () => mockPlanState.value,
  }
})

vi.mock('../retention-upgrade-notice', () => ({
  RetentionUpgradeNotice: () => <div>retention-upgrade-notice</div>,
}))

describe('Logs', () => {
  beforeEach(() => {
    mockPlanState.value = 'unrestricted'
    getChatConversations.mockReturnValue(new Promise(() => {}))
    getCompletionConversations.mockReturnValue(new Promise(() => {}))
  })

  it('should request chat conversations and show a loading state before data arrives', () => {
    render(<Logs appDetail={createAppDetailFixture({ id: 'app-1', mode: 'chat' })} />)

    expect(getChatConversations).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { app_id: 'app-1' },
      }),
    )
    expect(screen.getByRole('heading', { name: /(?:^|\.)title(?=$|:)/ })).toBeInTheDocument()
    expect(screen.getByText(/(?:^|\.)description(?=$|:)/)).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /(?:^|\.)operation\.learnMore(?=$|:)/ }),
    ).toHaveAttribute('href', 'https://docs.example.com/use-dify/monitor/logs')
    expect(screen.getByText('retention-upgrade-notice')).toBeInTheDocument()
    expect(screen.getByRole('row', { busy: true })).toBeInTheDocument()
  })

  it('should render the empty state for completion apps without logs', async () => {
    getCompletionConversations.mockResolvedValue({
      total: 0,
      data: [],
      page: 1,
      limit: APP_PAGE_LIMIT,
      has_more: false,
    })

    render(<Logs appDetail={createAppDetailFixture({ id: 'app-2', mode: 'completion' })} />)

    expect(getCompletionConversations).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { app_id: 'app-2' },
      }),
    )
    expect(await screen.findByText('appLog.table.empty.element.title')).toBeInTheDocument()
    expect(screen.queryByRole('row', { busy: true })).not.toBeInTheDocument()
  })

  it('should show a failed first load with a retry instead of a loading table', async () => {
    const user = userEvent.setup()
    getCompletionConversations.mockRejectedValueOnce(new Error('Offline')).mockResolvedValue({
      total: 0,
      data: [],
      page: 1,
      limit: APP_PAGE_LIMIT,
      has_more: false,
    })

    render(<Logs appDetail={createAppDetailFixture({ id: 'app-2', mode: 'completion' })} />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('common.api.actionFailed')
    expect(screen.queryByRole('row', { busy: true })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
    expect(await screen.findByText('appLog.table.empty.element.title')).toBeInTheDocument()
  })

  it('should update the page query parameter when pagination changes', async () => {
    const user = userEvent.setup()
    getChatConversations.mockResolvedValue({
      total: APP_PAGE_LIMIT + 1,
      data: [],
      page: 1,
      limit: APP_PAGE_LIMIT,
      has_more: false,
    })

    const { onUrlUpdate } = render(
      <Logs appDetail={createAppDetailFixture({ id: 'app-3', mode: 'chat' })} />,
    )

    await user.click(await screen.findByRole('button', { name: 'Go to page 2' }))

    await waitFor(() =>
      expect(onUrlUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          queryString: '?page=2',
          options: expect.objectContaining({ shallow: true }),
        }),
      ),
    )
    expect(getChatConversations.mock.calls.at(-1)?.[0].query.page).toBe(2)
  })

  it('keeps a typed Chatflow search focused and requests the first page once the keyword settles', async () => {
    const { onUrlUpdate } = render(
      <Logs appDetail={createAppDetailFixture({ id: 'chatflow-search', mode: 'advanced-chat' })} />,
      '?page=2',
    )
    expect(getChatConversations.mock.calls.at(-1)?.[0].query.page).toBe(2)
    getChatConversations.mockClear()

    const search = screen.getByRole('searchbox', { name: /common\.operation\.search/ })
    await runDebouncedUserInteraction(500, async (user) => {
      await user.type(search, 'invoice')
      expect(search).toHaveValue('invoice')
      expect(search).toHaveFocus()
      expect(getChatConversations).not.toHaveBeenCalled()
      expect(onUrlUpdate).not.toHaveBeenCalled()
    })

    expect(getChatConversations).toHaveBeenCalledTimes(1)
    expect(getChatConversations.mock.calls[0]?.[0].query).toMatchObject({
      page: 1,
      keyword: 'invoice',
    })
    expect(onUrlUpdate).toHaveBeenCalledOnce()
    expect(onUrlUpdate.mock.calls[0]?.[0].searchParams.has('page')).toBe(false)
    expect(search).toHaveFocus()
  })

  it('should query the last 30 days when a Sandbox user selects the longest period', async () => {
    const user = userEvent.setup()
    mockPlanState.value = 'sandbox'
    getChatConversations.mockResolvedValue({
      total: 0,
      data: [],
      page: 1,
      limit: APP_PAGE_LIMIT,
      has_more: false,
    })

    render(
      <Logs
        appDetail={createAppDetailFixture({
          id: 'app-sandbox-last-30-days',
          mode: 'chat' as const,
        })}
      />,
    )

    await user.click(
      await screen.findByRole('combobox', { name: /appLog\.filter\.period\.last7days/ }),
    )
    await user.click(await screen.findByText(/appLog\.filter\.period\.last30days/))

    expect(
      await screen.findByRole('combobox', { name: /appLog\.filter\.period\.last30days/ }),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(getChatConversations.mock.calls.at(-1)?.[0]).toEqual(
        expect.objectContaining({
          query: expect.objectContaining({
            start: dayjs().subtract(30, 'day').startOf('day').format('YYYY-MM-DD HH:mm'),
            end: dayjs().endOf('day').format('YYYY-MM-DD HH:mm'),
          }),
        }),
      ),
    )
  })

  it('should start each period on the current date after the page stays open past midnight', async () => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
    try {
      const user = userEvent.setup()
      getChatConversations.mockResolvedValue({
        total: 0,
        data: [],
        page: 1,
        limit: APP_PAGE_LIMIT,
        has_more: false,
      })
      render(
        <Logs
          appDetail={createAppDetailFixture({ id: 'app-past-midnight', mode: 'chat' as const })}
        />,
      )
      const selectPeriod = async (current: string, next: string) => {
        await user.click(
          await screen.findByRole('combobox', {
            name: new RegExp(`appLog\\.filter\\.period\\.${current}`),
          }),
        )
        await user.click(await screen.findByText(new RegExp(`appLog\\.filter\\.period\\.${next}`)))
      }
      const expectStart = (start: string) =>
        waitFor(() =>
          expect(getChatConversations.mock.calls.at(-1)?.[0]).toEqual(
            expect.objectContaining({ query: expect.objectContaining({ start }) }),
          ),
        )

      // The page has been open since earlier days; each request uses the date of the request.
      vi.setSystemTime(new Date(2026, 11, 1, 9))
      await selectPeriod('last7days', 'monthToDate')
      await expectStart('2026-12-01 00:00')
      await selectPeriod('monthToDate', 'quarterToDate')
      await expectStart('2026-10-01 00:00')
      await selectPeriod('quarterToDate', 'last3months')
      await expectStart('2026-09-01 00:00')

      vi.setSystemTime(new Date(2027, 0, 1, 9))
      await selectPeriod('last3months', 'yearToDate')
      await expectStart('2027-01-01 00:00')

      // Twelve months before February 29 is the last day of the shorter February.
      vi.setSystemTime(new Date(2028, 1, 29, 9))
      await selectPeriod('yearToDate', 'last12months')
      await expectStart('2027-02-28 00:00')
    } finally {
      vi.useRealTimers()
    }
  })

  it('should use today when a cached period is unavailable to a Sandbox workspace', async () => {
    const user = userEvent.setup()
    const appDetail = createAppDetailFixture({
      id: 'app-period-transition',
      mode: 'chat' as const,
    })
    getChatConversations.mockResolvedValue({
      total: 0,
      data: [],
      page: 1,
      limit: APP_PAGE_LIMIT,
      has_more: false,
    })

    const unrestrictedRender = render(<Logs appDetail={appDetail} />)

    await user.click(
      await screen.findByRole('combobox', { name: /appLog\.filter\.period\.last7days/ }),
    )
    await user.click(await screen.findByText(/appLog\.filter\.period\.allTime/))
    await waitFor(() =>
      expect(getChatConversations.mock.calls.at(-1)?.[0]).toEqual(
        expect.objectContaining({
          query: expect.not.objectContaining({
            start: expect.anything(),
            end: expect.anything(),
          }),
        }),
      ),
    )
    unrestrictedRender.unmount()

    mockPlanState.value = 'sandbox'
    render(<Logs appDetail={appDetail} />)

    expect(
      await screen.findByRole('combobox', { name: /appLog\.filter\.period\.today/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: /common\.operation\.clear appLog\.filter\.period\.today/,
      }),
    ).toBeInTheDocument()
    expect(getChatConversations.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        query: expect.objectContaining({
          start: dayjs().startOf('day').format('YYYY-MM-DD HH:mm'),
          end: expect.any(String),
        }),
      }),
    )
  })
})

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.chatConversations.get': (input) => getChatConversations(input),
      'apps.byAppId.completionConversations.get': (input) => getCompletionConversations(input),
      'apps.byAppId.annotations.count.get': () => Promise.resolve({ count: 0 }),
    }),
  }
})
