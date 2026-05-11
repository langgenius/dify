import type { UserProfileResponse } from '@/models/common'
import { ToastHost } from '@langgenius/dify-ui/toast'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { languages } from '@/i18n-config/language'
import { updateUserProfile } from '@/service/common'
import { timezones } from '@/utils/timezone'
import LanguagePage from '../index'

const mockRefresh = vi.fn()
const mockMutateUserProfile = vi.fn()
let mockLocale: string | undefined = 'en-US'
let mockUserProfile: UserProfileResponse

vi.mock('@langgenius/dify-ui/select', async () => {
  const React = await import('react')
  const SelectContext = React.createContext<{
    disabled?: boolean
    onValueChange?: (value: string) => void
  }>({})

  return {
    Select: ({
      children,
      disabled,
      onValueChange,
    }: {
      children: React.ReactNode
      disabled?: boolean
      onValueChange?: (value: string) => void
    }) => {
      return (
        <SelectContext.Provider value={{ disabled, onValueChange }}>
          <div>{children}</div>
        </SelectContext.Provider>
      )
    },
    SelectTrigger: ({ children }: { children: React.ReactNode }) => {
      const context = React.useContext(SelectContext)
      return (
        <div>
          <button type="button" disabled={context.disabled}>
            {children}
          </button>
          <button data-testid="select-empty" type="button" onClick={() => context.onValueChange?.('')}>
            empty value
          </button>
          <button data-testid="select-invalid" type="button" onClick={() => context.onValueChange?.('__missing__')}>
            invalid value
          </button>
        </div>
      )
    },
    SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectItem: ({ children, value }: { children: React.ReactNode, value: string }) => {
      const context = React.useContext(SelectContext)
      return (
        <button type="button" role="option" onClick={() => context.onValueChange?.(value)}>
          {children}
        </button>
      )
    },
    SelectItemText: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    SelectItemIndicator: () => null,
  }
})

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    userProfile: mockUserProfile,
    mutateUserProfile: mockMutateUserProfile,
  }),
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

const createUserProfile = (overrides: Partial<UserProfileResponse> = {}): UserProfileResponse => ({
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
  render(
    <>
      <LanguagePage />
      <ToastHost />
    </>,
  )
}

const getSectionByLabel = (sectionLabel: string) => {
  const label = screen.getByText(sectionLabel)
  const section = label.closest('div')?.parentElement
  if (!section)
    throw new Error(`Missing select section: ${sectionLabel}`)
  return section
}

const selectOption = async (sectionLabel: string, optionName: string) => {
  const section = getSectionByLabel(sectionLabel)
  await act(async () => {
    fireEvent.click(within(section).getAllByRole('button')[0]!)
  })
  await act(async () => {
    fireEvent.click(await within(section).findByRole('option', { name: optionName }))
  })
}

const getLanguageOption = (value: string) => {
  const option = languages.find(item => item.value === value)
  if (!option)
    throw new Error(`Missing language option: ${value}`)
  return option
}

const getTimezoneOption = (value: string) => {
  const option = timezones.find(item => item.value === value)
  if (!option)
    throw new Error(`Missing timezone option: ${value}`)
  return option
}

beforeEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  mockLocale = 'en-US'
  mockUserProfile = createUserProfile()
})

// Rendering
describe('LanguagePage - Rendering', () => {
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
    expect(screen.getByRole('button', { name: english.name })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: niueTimezone.name })).toBeInTheDocument()
  })

  it('should render placeholders when the current locale or timezone is unsupported', () => {
    mockLocale = 'unsupported-locale'
    mockUserProfile = createUserProfile({
      interface_language: 'unsupported-locale',
      timezone: 'Unsupported/Timezone',
    })

    renderPage()

    expect(screen.getAllByRole('button', { name: 'common.placeholder.select' })).toHaveLength(2)
  })
})

// Interactions
describe('LanguagePage - Interactions', () => {
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
    updateUserProfileMock.mockResolvedValueOnce({ result: 'success' })

    renderPage()

    await selectOption('common.language.timezone', midwayTimezone.name)

    expect(await screen.findByText('common.actionMsg.modifiedSuccessfully')).toBeInTheDocument()
    await waitFor(() => {
      expect(updateUserProfileMock).toHaveBeenCalledWith({
        url: '/account/timezone',
        body: { timezone: midwayTimezone.value },
      })
    })
  }, 15000)

  it('should show error toast when timezone update fails', async () => {
    const midwayTimezone = getTimezoneOption('Pacific/Midway')
    updateUserProfileMock.mockRejectedValueOnce(new Error('Timezone failed'))

    renderPage()

    await selectOption('common.language.timezone', midwayTimezone.name)

    expect(await screen.findByText('Timezone failed')).toBeInTheDocument()
  }, 15000)

  it('should ignore empty and unknown language selections', async () => {
    renderPage()

    const section = getSectionByLabel('common.language.displayLanguage')

    await act(async () => {
      fireEvent.click(within(section).getByTestId('select-empty'))
      fireEvent.click(within(section).getByTestId('select-invalid'))
    })

    expect(updateUserProfileMock).not.toHaveBeenCalled()
  })

  it('should ignore empty and unknown timezone selections', async () => {
    renderPage()

    const section = getSectionByLabel('common.language.timezone')

    await act(async () => {
      fireEvent.click(within(section).getByTestId('select-empty'))
      fireEvent.click(within(section).getByTestId('select-invalid'))
    })

    expect(updateUserProfileMock).not.toHaveBeenCalled()
  })
})
