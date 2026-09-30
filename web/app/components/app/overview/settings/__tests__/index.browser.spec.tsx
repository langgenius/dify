import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createAppSiteFixture } from '@/test/fixtures/app'
import SettingsModal from '../index'

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const { default: appOverview } = await import('@/i18n/locales/en-US/app-overview.json')
  const { default: common } = await import('@/i18n/locales/en-US/common.json')
  const { default: app } = await import('@/i18n/locales/en-US/app.json')
  return createReactI18nextMock({ ...appOverview, ...common, ...app })
})
vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))

function SettingsEntry() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Settings
      </button>
      <SettingsModal
        isChat
        isShow={open}
        appInfo={{ id: 'app-1', mode: 'advanced-chat', site: createAppSiteFixture() }}
        onClose={() => setOpen(false)}
      />
    </>
  )
}

afterEach(async () => {
  await page.viewport(1280, 720)
})

it('keeps settings and inline errors visible at 320 CSS pixels and restores focus after closing', async () => {
  await page.viewport(320, 640)
  const { wrapper: ConsoleQueries, queryClient } = createConsoleQueryWrapper({
    features: { webapp_copyright_enabled: true },
  })
  try {
    const screen = await render(
      <ConsoleQueries>
        <NuqsTestingAdapter>
          <SettingsEntry />
        </NuqsTestingAdapter>
      </ConsoleQueries>,
    )
    const entry = screen.getByRole('button', { name: 'Settings', exact: true })
    await entry.click()
    const dialog = page.getByRole('dialog', { name: 'Branding' })
    await expect.element(dialog).toBeVisible()
    const element = dialog.element()
    expect(element.scrollWidth).toBeLessThanOrEqual(element.clientWidth + 1)
    const color = dialog.getByRole('textbox', { name: 'Chat color theme', exact: true })
    await color.fill('invalid')
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect.element(color).toHaveFocus()
    await expect.element(color).toHaveAccessibleDescription(/Invalid hex value/)
    const error = dialog.getByText('Invalid hex value')
    await expect.element(error).toBeVisible()
    const dialogBounds = element.getBoundingClientRect()
    const colorBounds = color.element().getBoundingClientRect()
    const errorBounds = error.element().getBoundingClientRect()
    for (const bounds of [colorBounds, errorBounds]) {
      expect(bounds.left).toBeGreaterThanOrEqual(dialogBounds.left)
      expect(bounds.right).toBeLessThanOrEqual(dialogBounds.right)
      expect(bounds.top).toBeGreaterThanOrEqual(dialogBounds.top)
      expect(bounds.bottom).toBeLessThanOrEqual(dialogBounds.bottom)
    }
    await userEvent.keyboard('{Escape}')
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.element(entry).toHaveFocus()
  } finally {
    queryClient.clear()
  }
})
