import type { consoleClient } from '@/service/console'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import commonEn from '@/i18n/locales/en-US/common.json'
import commonZh from '@/i18n/locales/zh-Hans/common.json'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { setupFakeApi } from '@/test/fake-api'
import { createTestNavigation } from '@/test/next-navigation'
import InSiteMessageNotification from '../notification'

vi.unmock('react-i18next')
let pathname = '/apps'
beforeEach(() => {
  pathname = '/apps'
})
const notice = (
  body: string,
): Awaited<ReturnType<typeof consoleClient.notification.get>>['notifications'][number] => ({
  frequency: 'once',
  lang: 'en-US',
  notification_id: 'notice-1',
  title: 'Update\\nReady',
  subtitle: 'Details\\nBelow',
  title_pic_url: '',
  body,
})
async function setup(edition: 'CLOUD' | 'COMMUNITY' = 'CLOUD') {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { common: commonEn }, 'zh-Hans': { common: commonZh } },
    keySeparator: false,
    interpolation: { escapeValue: false },
  })
  const { wrapper: Providers } = createConsoleQueryWrapper({
    systemFeatures: { deployment_edition: edition },
  })
  const { NavigationProvider } = createTestNavigation({ url: pathname })
  const screen = await render(
    <NavigationProvider>
      <Providers>
        <I18nextProvider i18n={i18n}>
          <button type="button">Before notification</button>
          <InSiteMessageNotification />
        </I18nextProvider>
      </Providers>
    </NavigationProvider>,
  )
  return { screen, i18n }
}
const fake = setupFakeApi(() => ({
  console: {
    notification: {
      get: () => ({ should_show: false, notifications: [] }),
      dismiss: { post: () => ({ result: 'success' }) },
    },
  },
}))

it('keeps cloud notifications unavailable in Community even when the service has a notice', async () => {
  fake.console.notification.get.mockResolvedValue({
    should_show: true,
    notifications: [notice('Cloud update')],
  })
  const { screen } = await setup('COMMUNITY')
  await expect.element(screen.getByRole('button', { name: 'Before notification' })).toBeVisible()
  await expect.element(screen.getByText('Cloud update')).not.toBeInTheDocument()
  expect(fake.console.notification.get).not.toHaveBeenCalled()
})

it('stays off the collaboration demo it links to without dismissing the notice', async () => {
  pathname = '/collaboration-demo'
  fake.console.notification.get.mockResolvedValue({
    should_show: true,
    notifications: [notice('Cloud update')],
  })
  const { screen } = await setup()
  await expect.element(screen.getByRole('button', { name: 'Before notification' })).toBeVisible()
  await expect.element(screen.getByText('Cloud update')).not.toBeInTheDocument()
  expect(fake.console.notification.get).not.toHaveBeenCalled()
  expect(fake.console.notification.dismiss.post).not.toHaveBeenCalled()
})

it('replaces the displayed notice when the real interface language changes', async () => {
  fake.console.notification.get.mockImplementation((input) => ({
    should_show: true,
    notifications: [notice(input?.query?.language === 'zh-Hans' ? '中文更新' : 'English update')],
  }))
  const { screen, i18n } = await setup()
  await expect.element(screen.getByText('English update')).toBeVisible()
  await i18n.changeLanguage('zh-Hans')
  await expect.element(screen.getByText('中文更新')).toBeVisible()
  await expect.element(screen.getByText('English update')).not.toBeInTheDocument()
  await screen.getByRole('button', { name: commonZh['operation.close'], exact: true }).click()
  await expect.element(screen.getByText('中文更新')).not.toBeInTheDocument()
  await expect
    .poll(() => fake.console.notification.dismiss.post)
    .toHaveBeenCalledExactlyOnceWith({ body: { notification_id: 'notice-1' } })
})

it('renders parsed copy and safe links, then dismisses through the real keyboard action', async () => {
  fake.console.notification.get.mockResolvedValue({
    should_show: true,
    notifications: [
      notice(
        JSON.stringify({
          main: '**Parsed body main**',
          actions: [
            {
              action: 'link',
              data: 'https://example.com/docs',
              text: 'Visit docs',
              type: 'primary',
            },
            {
              action: 'link',
              data: { href: '/local-docs', target: '_self' },
              text: 'Local docs',
              type: 'outline',
            },
            {
              action: 'link',
              data: { rel: 'noopener' },
              text: 'Unavailable link',
              type: 'default',
            },
            { action: 'close', text: 'Dismiss now', type: 'default' },
            { action: 'link', data: '/invalid', text: 100, type: 'primary' },
          ],
        }),
      ),
    ],
  })
  const { screen } = await setup()
  await expect.element(screen.getByText('Parsed body main')).toBeVisible()
  expect(screen.getByText('Update Ready').element().textContent).toBe('Update\nReady')
  expect(screen.getByText('Details Below').element().textContent).toBe('Details\nBelow')
  const docs = screen.getByRole('link', { name: 'Visit docs' })
  await expect.element(docs).toHaveAttribute('href', 'https://example.com/docs')
  await expect.element(docs).toHaveAttribute('target', '_blank')
  await expect.element(docs).toHaveAttribute('rel', 'noopener noreferrer')
  const local = screen.getByRole('link', { name: 'Local docs' })
  await expect.element(local).toHaveAttribute('href', '/local-docs')
  await expect.element(local).toHaveAttribute('target', '_self')
  await expect.element(screen.getByRole('link', { name: '100' })).not.toBeInTheDocument()
  const invalid = screen.getByRole('button', { name: 'Unavailable link' })
  await invalid.click()
  await expect.element(screen.getByText('Parsed body main')).toBeVisible()
  expect(fake.console.notification.dismiss.post).not.toHaveBeenCalled()
  await screen.getByRole('button', { name: 'Before notification' }).click()
  await userEvent.tab()
  await expect.element(docs).toHaveFocus()
  await userEvent.tab()
  await expect.element(local).toHaveFocus()
  await userEvent.tab()
  await expect.element(invalid).toHaveFocus()
  await userEvent.tab()
  await expect.element(screen.getByRole('button', { name: 'Dismiss now' })).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(screen.getByText('Parsed body main')).not.toBeInTheDocument()
  await expect
    .poll(() => fake.console.notification.dismiss.post)
    .toHaveBeenCalledExactlyOnceWith({ body: { notification_id: 'notice-1' } })
})

it.each([
  { body: 'raw body text', content: 'raw body text' },
  {
    body: JSON.stringify({
      main: 'Parsed fallback',
      actions: [{ action: 'link', type: 'primary', text: 100 }],
    }),
    content: 'Parsed fallback',
  },
])(
  'offers a working close action when the payload needs fallback: $content',
  async ({ body, content }) => {
    fake.console.notification.get.mockResolvedValue({
      should_show: true,
      notifications: [notice(body)],
    })
    const { screen } = await setup()
    await expect.element(screen.getByText(content)).toBeVisible()
    await screen.getByRole('button', { name: 'Close', exact: true }).click()
    await expect.element(screen.getByText(content)).not.toBeInTheDocument()
    await expect
      .poll(() => fake.console.notification.dismiss.post)
      .toHaveBeenCalledExactlyOnceWith({ body: { notification_id: 'notice-1' } })
  },
)
