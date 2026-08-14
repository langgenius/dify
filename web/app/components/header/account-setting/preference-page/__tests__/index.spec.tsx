import type { GetAccountProfileResponse } from '@dify/contracts/api/console/account/types.gen'
import { ToastHost } from '@langgenius/dify-ui/toast'
import { QueryClientProvider } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { languages } from '@/i18n-config/language'
import { updateUserProfile } from '@/service/common'
import { createAccountProfileQueryClient } from '@/test/console/account-profile'
import { render } from '@/test/console/render'
import { timezones } from '@/utils/timezone'
import PreferencePage from '../index'

const mockGet = vi.hoisted(() => vi.fn())
const mockRequest = vi.hoisted(() => vi.fn())
const mockRefresh = vi.fn()
let mockLocale: string | undefined = 'en-US'
let mockUserProfile: GetAccountProfileResponse

vi.mock('@/service/base', () => ({
  get: mockGet,
  request: mockRequest,
  sseGeneratorPost: vi.fn(),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}))

vi.mock('@/context/i18n', () => ({
  useLocale: () => mockLocale,
}))

vi.mock('@/service/common', () => ({
  updateUserProfile: vi.fn(),
}))

vi.mock('@/i18n-config', () => ({
  setLocaleOnClient: vi.fn(),
}))

const updateUserProfileMock = vi.mocked(updateUserProfile)

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
      <ToastHost />
    </QueryClientProvider>,
  )
}

const getSectionByLabel = (sectionLabel: string) => {
  const label = screen.getByText(sectionLabel)
  const section = label.closest('div')?.parentElement
  if (!section) throw new Error(`Missing select section: ${sectionLabel}`)
  return section
}

const selectOption = async (sectionLabel: string, optionName: string) => {
  const user = userEvent.setup()
  const section = getSectionByLabel(sectionLabel)
  await user.click(within(section).getByRole('combobox'))
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

beforeEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  mockLocale = 'en-US'
  mockUserProfile = createUserProfile()
  const profileResponse = () =>
    new Response(JSON.stringify(mockUserProfile), {
      headers: { 'content-type': 'application/json' },
    })
  mockGet.mockImplementation(async () => profileResponse())
  mockRequest.mockImplementation(async () => profileResponse())
})

// Rendering
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
      within(getSectionByLabel('common.language.displayLanguage')).getByRole('combobox'),
    ).toHaveTextContent(english.name)
    expect(
      within(getSectionByLabel('common.language.timezone')).getByRole('combobox'),
    ).toHaveTextContent(niueTimezone.name)
  })

  it('should render placeholders when the current locale or timezone is unsupported', () => {
    mockLocale = 'unsupported-locale'
    mockUserProfile = createUserProfile({
      interface_language: 'unsupported-locale',
      timezone: 'Unsupported/Timezone',
    })

    renderPage()

    expect(
      within(getSectionByLabel('common.language.displayLanguage')).getByRole('combobox'),
    ).toHaveTextContent('common.placeholder.select')
    expect(
      within(getSectionByLabel('common.language.timezone')).getByRole('combobox'),
    ).toHaveTextContent('common.placeholder.select')
  })
})

// Interactions
describe('PreferencePage - Interactions', () => {
  it('should show success toast when language updates', async () => {
    const chinese = getLanguageOption('zh-Hans')
    mockUserProfile = createUserProfile({ interface_language: 'en-US' })
    updateUserProfileMock.mockResolvedValueOnce({ result: 'success' })

    renderPage()

    await selectOption('common.language.displayLanguage', chinese.name)

    expect(await screen.findByText('common.actionMsg.modifiedSuccessfully')).toBeInTheDocument()
    await waitFor(() => {
      expect(updateUserProfileMock).toHaveBeenCalledWith({
        url: '/account/interface-language',
        body: { interface_language: chinese.value },
      })
    })
  })

  it('should show error toast when language update fails', async () => {
    const chinese = getLanguageOption('zh-Hans')
    updateUserProfileMock.mockRejectedValueOnce(new Error('Update failed'))

    renderPage()

    await selectOption('common.language.displayLanguage', chinese.name)

    expect(await screen.findByText('Update failed')).toBeInTheDocument()
  })

  it('should show success toast when timezone updates', async () => {
    const midwayTimezone = getTimezoneOption('Pacific/Midway')

    renderPage()

    await selectOption('common.language.timezone', midwayTimezone.name)

    expect(await screen.findByText('common.actionMsg.modifiedSuccessfully')).toBeInTheDocument()
    await waitFor(() => {
      expect(mockRequest).toHaveBeenCalled()
    })
    expect(mockRequest.mock.calls[0]?.[0]).toEqual(expect.stringContaining('/account/timezone'))
    const request = mockRequest.mock.calls[0]?.[2]?.request as Request
    expect(request.method).toBe('POST')
    await expect(request.json()).resolves.toEqual({ timezone: midwayTimezone.value })
  }, 15000)

  it('should show error toast when timezone update fails', async () => {
    const midwayTimezone = getTimezoneOption('Pacific/Midway')
    mockRequest.mockRejectedValueOnce(new Error('Timezone failed'))

    renderPage()

    await selectOption('common.language.timezone', midwayTimezone.name)

    expect(await screen.findByText('Timezone failed')).toBeInTheDocument()
  }, 15000)
})
