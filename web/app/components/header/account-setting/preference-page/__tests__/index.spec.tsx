import type { GetAccountProfileResponse } from '@dify/contracts/api/console/account/types.gen'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppToaster } from '@/app/notifications/app-toaster'
import { setLocaleOnClient } from '@/i18n/client'
import { languages } from '@/i18n/language'
import { createAccountProfileQueryClient } from '@/test/console/account-profile'
import { render } from '@/test/console/render'
import { createDeferred } from '@/test/deferred'
import { timezones } from '@/utils/timezone'
import PreferencePage from '../index'

const mockGet = vi.hoisted(() => vi.fn())
const mockRequest = vi.hoisted(() => vi.fn())
const mockRefresh = vi.fn()
let mockLocale: string | undefined = 'en-US'
let mockUserProfile: GetAccountProfileResponse

vi.mock('@/service/base', () => ({
  get: mockGet,
  request: (url: string, init: RequestInit, options: { request: Request }) =>
    url.endsWith('/account/profile') && options.request.method === 'GET'
      ? mockGet(url, init, options)
      : mockRequest(url, init, options),
  sseGeneratorPost: vi.fn(),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}))

vi.mock('#i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#i18n')>()),
  useLocale: () => mockLocale,
}))

vi.mock('@/i18n/client', () => ({
  setLocaleOnClient: vi.fn(),
}))

const createUserProfile = (
  overrides: Partial<GetAccountProfileResponse> = {},
): GetAccountProfileResponse => ({
  id: 'user-id',
  name: 'Test User',
  email: 'test@example.com',
  avatar: '',
  avatar_url: null,
  is_password_set: false,
  interface_language: 'en-US',
  timezone: 'Pacific/Niue',
  ...overrides,
})

const renderPage = () => {
  const queryClient = createAccountProfileQueryClient(mockUserProfile)
  return render(
    <QueryClientProvider client={queryClient}>
      <PreferencePage />
      <AppToaster />
    </QueryClientProvider>,
  )
}

const selectOption = async (sectionLabel: string, optionName: string) => {
  const user = userEvent.setup()
  await user.click(screen.getByRole('combobox', { name: sectionLabel }))
  await user.click(await screen.findByRole('option', { name: optionName }))
}

const getLanguageOption = (value: string) => {
  const option = languages.find((item) => item.value === value)
  if (!option) throw new Error(`Missing language option: ${value}`)
  return option
}

const getTimezoneOption = (value: string) => {
  const option = timezones.find((item) => item.value === value)
  if (!option) throw new Error(`Missing timezone option: ${value}`)
  return option
}

const mockProfileFailure = async (message: string) => {
  const { request } = await vi.importActual<typeof import('@/service/base')>('@/service/base')
  mockRequest.mockImplementationOnce(request)
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response(JSON.stringify({ message, code: 'invalid_param' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    }),
  )
}

beforeEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.clearAllMocks()
  vi.mocked(setLocaleOnClient).mockReset().mockResolvedValue(undefined)
  mockLocale = 'en-US'
  mockUserProfile = createUserProfile()
  const profileResponse = () =>
    new Response(JSON.stringify(mockUserProfile), {
      headers: { 'content-type': 'application/json' },
    })
  mockGet.mockReset().mockImplementation(async () => profileResponse())
  mockRequest.mockReset().mockImplementation(async () => profileResponse())
})

afterEach(() => vi.restoreAllMocks())

describe('PreferencePage - Rendering', () => {
  it('should render default language and timezone labels', () => {
    const english = getLanguageOption('en-US')
    const niueTimezone = getTimezoneOption('Pacific/Niue')
    mockLocale = undefined
    mockUserProfile = createUserProfile({
      interface_language: english.value.toString(),
      timezone: niueTimezone.value.toString(),
    })

    renderPage()

    expect(screen.getByText('common.language.displayLanguage')).toBeInTheDocument()
    expect(screen.getByText('common.language.timezone')).toBeInTheDocument()
    expect(
      screen.getByRole('combobox', { name: 'common.language.displayLanguage' }),
    ).toHaveTextContent(english.name)
    expect(screen.getByRole('combobox', { name: 'common.language.timezone' })).toHaveTextContent(
      niueTimezone.name,
    )
  })

  it('should render placeholders when the current locale or timezone is unsupported', () => {
    mockLocale = 'unsupported-locale'
    mockUserProfile = createUserProfile({
      interface_language: 'unsupported-locale',
      timezone: 'Unsupported/Timezone',
    })

    renderPage()

    expect(
      screen.getByRole('combobox', { name: 'common.language.displayLanguage' }),
    ).toHaveTextContent('common.placeholder.select')
    expect(screen.getByRole('combobox', { name: 'common.language.timezone' })).toHaveTextContent(
      'common.placeholder.select',
    )
  })
})

describe('PreferencePage - Interactions', () => {
  it('should focus the timezone trigger without opening or saving when its label is clicked', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByText('common.language.timezone'))

    const trigger = screen.getByRole('combobox', { name: 'common.language.timezone' })
    expect(trigger).toHaveFocus()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(mockRequest).not.toHaveBeenCalled()
  })

  it.each(['  bEiJiNg  ', 'Asia/Shanghai', '+08:00'])(
    'should filter timezones by %s without saving a preference',
    async (query) => {
      const user = userEvent.setup()
      renderPage()

      await user.click(screen.getByRole('combobox', { name: 'common.language.timezone' }))
      await user.type(
        screen.getByRole('combobox', { name: 'accountSettings.account.timezoneSearchPlaceholder' }),
        query,
      )

      expect(
        await screen.findByRole('option', { name: getTimezoneOption('Asia/Shanghai').name }),
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('option', { name: getTimezoneOption('Pacific/Niue').name }),
      ).not.toBeInTheDocument()
      expect(mockRequest).not.toHaveBeenCalled()
    },
  )

  it('should preserve the saved timezone after an empty search is dismissed', async () => {
    const user = userEvent.setup()
    renderPage()
    const trigger = screen.getByRole('combobox', { name: 'common.language.timezone' })

    await user.click(trigger)
    await user.type(
      screen.getByRole('combobox', { name: 'accountSettings.account.timezoneSearchPlaceholder' }),
      'no-such-timezone',
    )
    expect(await screen.findByText('accountSettings.account.timezoneNoResults')).toBeInTheDocument()
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
    await user.keyboard('{Escape}')

    expect(trigger).toHaveTextContent(getTimezoneOption('Pacific/Niue').name)
    expect(mockRequest).not.toHaveBeenCalled()
    await user.click(trigger)
    expect(
      screen.getByRole('combobox', { name: 'accountSettings.account.timezoneSearchPlaceholder' }),
    ).toHaveValue('')
    expect(
      await screen.findByRole('option', { name: getTimezoneOption('Pacific/Niue').name }),
    ).toBeInTheDocument()
  })

  it('should keep profile controls disabled until saving, refetching, and changing language finish', async () => {
    const chinese = getLanguageOption('zh-Hans')
    mockUserProfile = createUserProfile({ interface_language: 'en-US' })
    const save = createDeferred<Response>()
    const refetch = createDeferred<Response>()
    const changeLanguage = createDeferred<void>()
    mockRequest.mockReturnValueOnce(save.promise)
    mockGet.mockReturnValueOnce(refetch.promise)
    vi.mocked(setLocaleOnClient).mockReturnValueOnce(changeLanguage.promise)

    renderPage()
    const language = screen.getByRole('combobox', { name: 'common.language.displayLanguage' })
    const timezone = screen.getByRole('combobox', { name: 'common.language.timezone' })
    const appearance = screen.getByRole('combobox', {
      name: 'accountSettings.account.appearanceLabel',
    })

    await selectOption('common.language.displayLanguage', chinese.name)

    expect(language).toBeDisabled()
    expect(timezone).toBeDisabled()
    expect(appearance).toBeEnabled()
    await waitFor(() => expect(mockRequest).toHaveBeenCalledOnce())
    expect(language).toHaveFocus()
    expect(mockRequest.mock.calls[0]?.[0]).toEqual(expect.stringContaining('/account/profile'))
    const request = mockRequest.mock.calls[0]?.[2]?.request as Request
    expect(request.method).toBe('PATCH')
    await expect(request.json()).resolves.toEqual({ interface_language: chinese.value })

    const savedProfile = createUserProfile({ interface_language: chinese.value })
    const response = () =>
      new Response(JSON.stringify(savedProfile), {
        headers: { 'content-type': 'application/json' },
      })
    await act(async () => save.resolve(response()))
    await waitFor(() => expect(mockGet).toHaveBeenCalled())
    await waitFor(() => expect(setLocaleOnClient).toHaveBeenCalledWith(chinese.value, false))
    expect(language).toBeDisabled()
    expect(timezone).toBeDisabled()
    expect(mockRefresh).not.toHaveBeenCalled()

    await act(async () => {
      mockLocale = chinese.value
      changeLanguage.resolve()
    })
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledOnce())
    expect(language).toBeDisabled()
    expect(timezone).toBeDisabled()

    await act(async () => refetch.resolve(response()))
    await waitFor(() => expect(language).toBeEnabled())
    expect(timezone).toBeEnabled()
    expect(language).toHaveTextContent(chinese.name)
    expect(mockRefresh).toHaveBeenCalledOnce()
  })

  it('should show one request-layer error and restore controls when language saving fails', async () => {
    const chinese = getLanguageOption('zh-Hans')
    await mockProfileFailure('Update failed')

    renderPage()

    await selectOption('common.language.displayLanguage', chinese.name)

    expect(await screen.findAllByText('Update failed')).toHaveLength(1)
    await waitFor(() =>
      expect(
        screen.getByRole('combobox', { name: 'common.language.displayLanguage' }),
      ).toBeEnabled(),
    )
    expect(screen.getByRole('combobox', { name: 'common.language.timezone' })).toBeEnabled()
    expect(setLocaleOnClient).not.toHaveBeenCalled()
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('should report client-side language failures without repeating the saved request', async () => {
    vi.mocked(setLocaleOnClient).mockRejectedValueOnce(new Error('Language resources unavailable'))
    renderPage()

    await selectOption('common.language.displayLanguage', getLanguageOption('zh-Hans').name)

    expect(await screen.findAllByText('Language resources unavailable')).toHaveLength(1)
    await waitFor(() =>
      expect(
        screen.getByRole('combobox', { name: 'common.language.displayLanguage' }),
      ).toBeEnabled(),
    )
    expect(mockRequest).toHaveBeenCalledOnce()
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('should save a filtered timezone selected with the keyboard and display the saved value', async () => {
    const user = userEvent.setup()
    const midwayTimezone = getTimezoneOption('Pacific/Midway')
    mockRequest.mockImplementationOnce(async () => {
      mockUserProfile = createUserProfile({ timezone: midwayTimezone.value })
      return new Response(JSON.stringify(mockUserProfile), {
        headers: { 'content-type': 'application/json' },
      })
    })
    renderPage()

    const trigger = screen.getByRole('combobox', { name: 'common.language.timezone' })
    await user.click(trigger)
    await user.type(
      screen.getByRole('combobox', { name: 'accountSettings.account.timezoneSearchPlaceholder' }),
      midwayTimezone.value,
    )
    await screen.findByRole('option', { name: midwayTimezone.name })
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(mockRequest).toHaveBeenCalled()
    })
    expect(mockRequest.mock.calls[0]?.[0]).toEqual(expect.stringContaining('/account/profile'))
    const request = mockRequest.mock.calls[0]?.[2]?.request as Request
    expect(request.method).toBe('PATCH')
    await expect(request.json()).resolves.toEqual({ timezone: midwayTimezone.value })
    await waitFor(() => expect(trigger).toHaveTextContent(midwayTimezone.name))
  }, 15000)

  it('should show one request-layer error and preserve the saved timezone on failure', async () => {
    const midwayTimezone = getTimezoneOption('Pacific/Midway')
    await mockProfileFailure('Timezone failed')

    renderPage()

    await selectOption('common.language.timezone', midwayTimezone.name)

    expect(await screen.findAllByText('Timezone failed')).toHaveLength(1)
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'common.language.timezone' })).toBeEnabled(),
    )
    expect(screen.getByRole('combobox', { name: 'common.language.timezone' })).toHaveTextContent(
      getTimezoneOption('Pacific/Niue').name,
    )
    expect(screen.getByRole('combobox', { name: 'common.language.timezone' })).toBeEnabled()
  }, 15000)
})
