import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { DirectionProvider } from '@langgenius/dify-ui/direction-provider'
import { useQueryState } from 'nuqs'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import {
  settingsQueryParamName,
  settingsQueryParser,
} from '@/app/components/header/account-setting/query-params'
import AccountSection from '@/app/components/main-nav/components/account-section'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { installFakeApi } from '@/test/fake-api'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import AccountMenu from '../index'

// The menu journeys never sign out; any request they make fails the test.
beforeEach(() => onTestFinished(installFakeApi({})))

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

it.each(['ltr', 'rtl'] as const)(
  'opens the appearance submenu toward the reading direction in %s',
  async (direction) => {
    await page.viewport(1280, 800)
    const { wrapper: ConsoleProvider } = createConsoleQueryWrapper({
      accountProfile: { name: 'Current User', email: 'current@example.com' },
      features: { education: { enabled: false } },
    })
    const { wrapper: NuqsProvider } = createNuqsTestWrapper()
    const previousDirection = document.documentElement.dir
    document.documentElement.dir = direction
    try {
      const screen = await render(
        <DirectionProvider direction={direction}>
          <ConsoleProvider>
            <NuqsProvider>
              <div style={{ marginInline: 'auto', paddingTop: 300, width: 240 }}>
                <AccountMenu
                  trigger={({ ariaLabel }) => <button aria-label={ariaLabel}>Account</button>}
                />
              </div>
            </NuqsProvider>
          </ConsoleProvider>
        </DirectionProvider>,
      )
      await screen.getByRole('button', { name: 'accountSettings.account.account' }).click()
      const appearance = screen.getByRole('menuitem', {
        name: 'common.theme.label',
      })
      await userEvent.hover(appearance)
      const submenu = screen.getByRole('menu', { name: 'common.theme.label' })
      await expect.element(submenu).toBeVisible()
      // Leave room on both sides so collision fallback cannot hide a fixed-side override.
      await expect
        .poll(() => {
          const triggerBounds = appearance.element().getBoundingClientRect()
          const submenuBounds = submenu.element().getBoundingClientRect()
          return direction === 'rtl'
            ? submenuBounds.right <= triggerBounds.left
            : submenuBounds.left >= triggerBounds.right
        })
        .toBe(true)
      await userEvent.hover(screen.getByRole('menuitemradio', { name: 'common.theme.light' }))
      await expect.element(submenu).toBeVisible()
      await userEvent.keyboard('{Escape}')
      await expect.element(appearance).toHaveFocus()
    } finally {
      document.documentElement.dir = previousDirection
    }
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

it.each(['keyboard', 'pointer'])(
  'keeps visible focus after opening with %s and dismissing with Escape',
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
    }
    await expect.element(screen.getByRole('menu')).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(trigger).toHaveFocus()
    expect(trigger.element().matches(':focus-visible')).toBe(true)
    expect(getComputedStyle(trigger.element()).boxShadow).not.toBe('none')
  },
)
