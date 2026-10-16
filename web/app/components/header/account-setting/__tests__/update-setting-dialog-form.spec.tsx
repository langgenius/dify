import type { SettingsDestination } from '@/app/components/header/account-setting/query-params'
import { Dialog } from '@langgenius/dify-ui/dialog'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import {
  AUTO_UPDATE_MODE,
  AUTO_UPDATE_STRATEGY,
} from '@/app/components/plugins/reference-setting-modal/auto-update-setting/types'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { UpdateSettingDialogForm } from '../update-setting-dialog-form'

const mockSetSettingsDestination = vi.fn()
let mockSettingsDestination: SettingsDestination | null = null
vi.mock('nuqs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nuqs')>()
  return {
    ...actual,
    useQueryState: () => [mockSettingsDestination, mockSetSettingsDestination],
  }
})

vi.mock('react-i18next', async () => {
  const { withSelectorKey, withSelectorKeyProps } = await import('@/test/i18n-mock')
  return {
    useTranslation: (defaultNs?: string) => ({
      t: withSelectorKey((key: string, options?: Record<string, unknown>) => {
        const ns = (options?.ns as string | undefined) ?? defaultNs
        return `${ns ? `${ns}.` : ''}${key}`
      }),
      i18n: {
        language: 'en',
        changeLanguage: vi.fn(),
      },
    }),
    Trans: withSelectorKeyProps(
      ({
        i18nKey,
        components,
      }: {
        i18nKey: string
        components?: Record<string, React.ReactElement>
      }) => {
        const setTimezone = components?.setTimezone
        if (setTimezone) return React.cloneElement(setTimezone, undefined, i18nKey)

        return <span>{i18nKey}</span>
      },
    ),
  }
})

vi.mock(
  '@/app/components/plugins/reference-setting-modal/auto-update-setting/plugins-picker',
  () => ({
    default: () => <div data-testid="plugins-picker" />,
  }),
)

function renderForm(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
  client.setQueryData(userProfileQueryOptions().queryKey, {
    profile: {
      id: 'user-1',
      name: 'Test User',
      email: 'test@dify.ai',
      avatar_url: null,
      is_password_set: false,
      timezone: 'UTC',
    },
    meta: { currentVersion: null, currentEnv: null },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

describe('UpdateSettingDialogForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSettingsDestination = null
  })

  it('should focus update time from its label and keep the timezone action separate', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()

    renderForm(
      <Dialog defaultOpen onOpenChange={onOpenChange}>
        <UpdateSettingDialogForm
          initialAutoUpgrade={{
            strategy_setting: AUTO_UPDATE_STRATEGY.fixOnly,
            upgrade_time_of_day: 0,
            upgrade_mode: AUTO_UPDATE_MODE.update_all,
            exclude_plugins: [],
            include_plugins: [],
          }}
          category={PluginCategoryEnum.tool}
          isSavePending={false}
          onSave={vi.fn()}
        />
      </Dialog>,
    )

    expect(
      screen.getByRole('button', { name: /autoUpdate.updateTime.*12:00 AM.*UTC/ }),
    ).toBeInTheDocument()
    await user.click(screen.getByText('plugin.autoUpdate.updateTime', { exact: true }))
    expect(
      screen.getByRole('button', { name: /autoUpdate.updateTime.*12:00 AM.*UTC/ }),
    ).toHaveFocus()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByText('autoUpdate.changeTimezone'))

    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false, expect.anything())
    expect(mockSetSettingsDestination).toHaveBeenCalledWith('preferences')
  })

  it('should replace the current destination when timezone link is clicked inside settings', () => {
    mockSettingsDestination = 'provider'

    renderForm(
      <Dialog>
        <UpdateSettingDialogForm
          initialAutoUpgrade={{
            strategy_setting: AUTO_UPDATE_STRATEGY.fixOnly,
            upgrade_time_of_day: 0,
            upgrade_mode: AUTO_UPDATE_MODE.update_all,
            exclude_plugins: [],
            include_plugins: [],
          }}
          category={PluginCategoryEnum.tool}
          isSavePending={false}
          onSave={vi.fn()}
        />
      </Dialog>,
    )

    fireEvent.click(screen.getByText('autoUpdate.changeTimezone'))

    expect(mockSetSettingsDestination).toHaveBeenCalledWith('preferences', {
      history: 'replace',
      shallow: true,
    })
  })
})
