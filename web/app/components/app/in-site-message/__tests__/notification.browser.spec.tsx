import type { consoleClient } from '@/service/console'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import commonEn from '@/i18n/locales/en-US/common.json'
import commonZh from '@/i18n/locales/zh-Hans/common.json'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import InSiteMessageNotification from '../notification'

vi.unmock('react-i18next')
const api = vi.hoisted(() => ({
  list: vi.fn<typeof consoleClient.notification.get>(),
  dismiss: vi.fn<typeof consoleClient.notification.dismiss.post>(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'notification.get': api.list,
      'notification.dismiss.post': api.dismiss,
    }),
  }
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
  const screen = await render(
    <Providers>
      <I18nextProvider i18n={i18n}>
        <button type="button">Before notification</button>
        <InSiteMessageNotification />
      </I18nextProvider>
    </Providers>,
  )
  return { screen, i18n }
}
beforeEach(() => {
  onTestFinished(guardUnexpectedFetch())
  api.list.mockReset().mockResolvedValue({ should_show: false, notifications: [] })
  api.dismiss.mockReset().mockResolvedValue({ result: 'success' })
})

it('keeps cloud notifications unavailable in Community even when the service has a notice', async () => {
  api.list.mockResolvedValue({ should_show: true, notifications: [notice('Cloud update')] })
  const { screen } = await setup('COMMUNITY')
  await expect.element(screen.getByRole('button', { name: 'Before notification' })).toBeVisible()
  await expect.element(screen.getByText('Cloud update')).not.toBeInTheDocument()
  expect(api.list).not.toHaveBeenCalled()
})

it('replaces the displayed notice when the real interface language changes', async () => {
  api.list.mockImplementation(
    async ({ query }: NonNullable<Parameters<typeof consoleClient.notification.get>[0]> = {}) => ({
      should_show: true,
      notifications: [notice(query?.language === 'zh-Hans' ? '中文更新' : 'English update')],
    }),
  )
  const { screen, i18n } = await setup()
  await expect.element(screen.getByText('English update')).toBeVisible()
  await i18n.changeLanguage('zh-Hans')
  await expect.element(screen.getByText('中文更新')).toBeVisible()
  await expect.element(screen.getByText('English update')).not.toBeInTheDocument()
  await screen.getByRole('button', { name: commonZh['operation.close'], exact: true }).click()
  await expect.element(screen.getByText('中文更新')).not.toBeInTheDocument()
  expect(api.dismiss).toHaveBeenCalledExactlyOnceWith({ body: { notification_id: 'notice-1' } })
})

it('renders parsed copy and safe links, then dismisses through the real keyboard action', async () => {
  api.list.mockResolvedValue({
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
  expect(api.dismiss).not.toHaveBeenCalled()
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
  expect(api.dismiss).toHaveBeenCalledExactlyOnceWith({ body: { notification_id: 'notice-1' } })
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
    api.list.mockResolvedValue({ should_show: true, notifications: [notice(body)] })
    const { screen } = await setup()
    await expect.element(screen.getByText(content)).toBeVisible()
    await screen.getByRole('button', { name: 'Close', exact: true }).click()
    await expect.element(screen.getByText(content)).not.toBeInTheDocument()
    expect(api.dismiss).toHaveBeenCalledExactlyOnceWith({ body: { notification_id: 'notice-1' } })
  },
)
