import { page } from 'vite-plus/test/browser'
import appLog from '@/i18n/locales/en-US/app-log.json'
import time from '@/i18n/locales/en-US/time.json'
import { openExport } from './log-export-fixture'

// boundary: Use shipped labels so the test measures the controls as users see them.
vi.mock('react-i18next', async (importOriginal) => {
  const original = await importOriginal<typeof import('react-i18next')>()
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const { default: appLogCopy } = await import('@/i18n/locales/en-US/app-log.json')
  const { default: timeCopy } = await import('@/i18n/locales/en-US/time.json')
  const mock = createReactI18nextMock({
    ...appLogCopy,
    ...timeCopy,
    'export.previewConversationCount': appLogCopy['export.previewConversationCount_other'],
    'export.previewRowCount': appLogCopy['export.previewRowCount_other'],
  })
  return {
    ...original,
    ...mock,
    useTranslation: (...args: Parameters<typeof mock.useTranslation>) => ({
      ...mock.useTranslation(...args),
      ready: true,
    }),
  }
})

// boundary: Resolve the docs link without the application locale provider.
vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.example.test${path}`,
}))

it('keeps custom date controls and filter values aligned inside a narrow export dialog', async () => {
  await page.viewport(320, 900)
  const { screen } = await openExport(false, 'advanced-chat')
  await screen.getByRole('button', { name: appLog['export.title'] }).click()
  const dialog = page.getByRole('dialog', { name: appLog['export.title'] })
  const period = dialog.getByRole('combobox', { name: appLog['export.timeRange'] })
  await expect.element(period).toBeVisible()

  await period.click()
  await page.getByRole('option', { name: appLog['filter.period.custom'] }).click()
  const startDate = dialog.getByRole('button', { name: new RegExp(`^${time['picker.startDate']}`) })
  const endDate = dialog.getByRole('button', { name: new RegExp(`^${time['picker.endDate']}`) })
  const status = dialog.getByRole('combobox', { name: appLog['table.header.status'] })
  const identity = dialog.getByRole('combobox', { name: appLog['table.header.endUser'] })
  const filters = [period, startDate, endDate, status, identity]
  for (const filter of filters) await expect.element(filter).toBeVisible()

  const bounds = dialog.element().getBoundingClientRect()
  for (const filter of filters) {
    const { left, right } = filter.element().getBoundingClientRect()
    expect(left).toBeGreaterThan(bounds.left)
    expect(right).toBeLessThan(bounds.right)
  }
  expect(startDate.element().getBoundingClientRect().right).toBeLessThan(
    endDate.element().getBoundingClientRect().left,
  )
  const statusValue = status.getByText(appLog['filter.annotation.all'], { exact: true })
  const identityValue = identity.getByText(appLog['export.identitiesAll'], { exact: true })
  await expect.element(statusValue).toBeVisible()
  await expect.element(identityValue).toBeVisible()
  expect(identityValue.element().getBoundingClientRect().left).toBeCloseTo(
    statusValue.element().getBoundingClientRect().left,
    0,
  )
})
