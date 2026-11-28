import { page } from 'vite-plus/test/browser'
import appLog from '@/i18n/locales/en-US/app-log.json'
import common from '@/i18n/locales/en-US/common.json'
import { openExport } from './log-export-fixture'

// boundary: Use the shipped toolbar copy because translation keys distort control widths.
vi.mock('react-i18next', async (importOriginal) => {
  const original = await importOriginal<typeof import('react-i18next')>()
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const { default: appLogCopy } = await import('@/i18n/locales/en-US/app-log.json')
  const { default: commonCopy } = await import('@/i18n/locales/en-US/common.json')
  const translations = Object.fromEntries(
    Object.entries({ appLog: appLogCopy, common: commonCopy }).flatMap(([namespace, copy]) =>
      Object.entries(copy).map(([key, value]) => [`${namespace}.${key}`, value]),
    ),
  )
  const mock = createReactI18nextMock(translations)
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

it('keeps Export logs aligned with the custom date filters at desktop width', async () => {
  // The Logs fixture adds 32px side padding, leaving 1160px for the toolbar.
  await page.viewport(1224, 900)
  const { screen } = await openExport(false, 'advanced-chat')
  await screen.getByRole('combobox', { name: appLog['filter.period.last7days'] }).click()
  await page.getByRole('option', { name: appLog['filter.period.custom'] }).click()

  const controls = [
    screen.getByRole('combobox', { name: appLog['filter.period.custom'] }),
    screen.getByRole('button', { name: /^time\.picker\.startDate/ }),
    screen.getByRole('button', { name: /^time\.picker\.endDate/ }),
    screen.getByRole('combobox', {
      name: `${appLog['table.header.status']} ${appLog['filter.annotation.all']}`,
    }),
    screen.getByRole('combobox', { name: appLog['table.header.endUser'] }),
    screen.getByPlaceholder(common['operation.search']),
    screen.getByRole('button', { name: /^Sort by:/ }),
    screen.getByRole('button', { name: common['sorting.ascending'] }),
    screen.getByRole('button', { name: appLog['export.title'] }),
  ]
  for (const control of controls) {
    await expect.element(control).toBeVisible()
  }

  const boxes = controls.map((control) => control.element().getBoundingClientRect())
  const centers = boxes.map(({ top, height }) => top + height / 2)
  expect(Math.max(...centers) - Math.min(...centers)).toBeLessThanOrEqual(1)
  for (const [index, box] of boxes.slice(1).entries()) {
    expect(box.left).toBeGreaterThanOrEqual(boxes[index]!.right)
  }
  expect(boxes.at(-1)!.right).toBeLessThanOrEqual(window.innerWidth - 32)
})
