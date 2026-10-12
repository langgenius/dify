import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { useQueryState } from 'nuqs'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import {
  settingsQueryParamName,
  settingsQueryParser,
} from '@/app/components/header/account-setting/query-params'
import AccountSection from '@/app/components/main-nav/components/account-section'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'

vi.mock('@/service/use-common', () => ({ useLogout: () => ({ mutate: vi.fn() }) }))
vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'system', setTheme: vi.fn() }),
}))

// The settings contents are outside the menu's focus contract; retain a real destination dialog.
function PreferencesDestination() {
  const [destination] = useQueryState(settingsQueryParamName, settingsQueryParser)
  return (
    <Dialog open={destination === 'preferences'}>
      <DialogContent>
        <DialogTitle>Preferences destination</DialogTitle>
        <label>
          Preference
          <input />
        </label>
      </DialogContent>
    </Dialog>
  )
}

async function renderAccount() {
  const { wrapper: ConsoleProvider } = createConsoleQueryWrapper({
    accountProfile: { name: 'Current User', email: 'current@example.com' },
    features: { education: { enabled: false } },
  })
  const { wrapper: NuqsProvider } = createNuqsTestWrapper()
  return render(
    <ConsoleProvider>
      <NuqsProvider>
        <div style={{ padding: 40 }}>
          <button type="button">Before account</button>
          <AccountSection />
        </div>
        <PreferencesDestination />
      </NuqsProvider>
    </ConsoleProvider>,
  )
}

// Chromium supplies the native focus-visible heuristic after menu focus restoration.
it.each(['outside', 'Escape'])(
  'does not highlight a pointer-opened account trigger after %s dismissal',
  async (dismiss) => {
    const screen = await renderAccount()
    const trigger = screen.getByRole('button', {
      name: 'Current User accountSettings.account.account',
    })
    await trigger.click()
    await expect.element(screen.getByRole('menu')).toBeVisible()
    if (dismiss === 'Escape') await userEvent.keyboard('{Escape}')
    else
      await screen
        .getByRole('presentation')
        .filter({ hasNotText: 'current@example.com' })
        .click({ position: { x: 10, y: 600 } })
    await expect.element(screen.getByRole('menu')).not.toBeInTheDocument()
    if (dismiss === 'Escape') await expect.element(trigger).toHaveFocus()
    expect(trigger.element().matches(':focus-visible')).toBe(false)
  },
)

it('keeps focus in Preferences after the account menu finishes closing', async () => {
  const settings = globalThis as typeof globalThis & { BASE_UI_ANIMATIONS_DISABLED: boolean }
  const animationsDisabled = settings.BASE_UI_ANIMATIONS_DISABLED
  settings.BASE_UI_ANIMATIONS_DISABLED = false
  try {
    const screen = await renderAccount()
    await screen
      .getByRole('button', { name: 'Current User accountSettings.account.account' })
      .click()
    await screen.getByRole('menuitem', { name: 'navigation.settings.preferences' }).click()
    const input = screen.getByRole('textbox', { name: 'Preference' })
    await expect.element(input).toHaveFocus()
    await expect.element(screen.getByRole('menu')).not.toBeInTheDocument()
    await expect.element(input).toHaveFocus()
  } finally {
    settings.BASE_UI_ANIMATIONS_DISABLED = animationsDisabled
  }
})

it.each(['keyboard', 'pointer then keyboard'])(
  'keeps visible focus after %s navigation and Escape dismissal',
  async (interaction) => {
    const screen = await renderAccount()
    const trigger = screen.getByRole('button', {
      name: 'Current User accountSettings.account.account',
    })
    if (interaction === 'keyboard') {
      await screen.getByRole('button', { name: 'Before account' }).click()
      await userEvent.keyboard('{Tab}{Enter}')
    } else {
      await trigger.click()
      await userEvent.keyboard('{ArrowDown}')
    }
    await expect.element(screen.getByRole('menu')).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(trigger).toHaveFocus()
    expect(trigger.element().matches(':focus-visible')).toBe(true)
    expect(getComputedStyle(trigger.element()).boxShadow).not.toBe('none')
  },
)

it('clears the keyboard focus ring when the same account menu is reopened and dismissed with the pointer', async () => {
  const settings = globalThis as typeof globalThis & { BASE_UI_ANIMATIONS_DISABLED: boolean }
  const animationsDisabled = settings.BASE_UI_ANIMATIONS_DISABLED
  settings.BASE_UI_ANIMATIONS_DISABLED = false
  try {
    const screen = await renderAccount()
    const trigger = screen.getByRole('button', {
      name: 'Current User accountSettings.account.account',
    })
    const menu = screen.getByRole('menu')
    const dismissWithPointer = async () => {
      await trigger.click()
      await expect.element(menu).toBeVisible()
      await screen
        .getByRole('presentation')
        .filter({ hasNotText: 'current@example.com' })
        .click({ position: { x: 10, y: 600 } })
      await expect.element(menu).not.toBeInTheDocument()
      expect(trigger.element().matches(':focus-visible')).toBe(false)
    }

    await dismissWithPointer()

    await screen.getByRole('button', { name: 'Before account' }).click()
    await userEvent.keyboard('{Tab}{Enter}{ArrowDown}')
    await expect.element(menu).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(menu).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
    expect(trigger.element().matches(':focus-visible')).toBe(true)

    await dismissWithPointer()
  } finally {
    settings.BASE_UI_ANIMATIONS_DISABLED = animationsDisabled
  }
})
