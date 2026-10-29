// @vitest-environment node

import { Suspense } from 'react'
import { renderToReadableStream } from 'react-dom/server'
import { useTranslation } from 'react-i18next'
import { I18nClientProvider } from '@/app/components/provider/i18n'

vi.unmock('react-i18next')
const mocks = vi.hoisted(() => ({ loadResource: vi.fn() }))
vi.mock('../load-resource', () => ({ loadI18nResource: mocks.loadResource }))

function SignIn() {
  const { t } = useTranslation(['login'])
  return <h1>{t(($) => $.signBtn)}</h1>
}

describe('on-demand translations during SSR', () => {
  it('streams only rendered namespaces with fallback and isolates concurrent locales', async () => {
    mocks.loadResource.mockImplementation(async (locale: string, namespace: string) => ({
      default: namespace === 'login' && locale === 'en-US' ? { signBtn: 'Sign in' } : {},
    }))
    const render = async (locale: 'en-US' | 'zh-Hans') => {
      const errors: unknown[] = []
      const stream = await renderToReadableStream(
        <I18nClientProvider locale={locale} resource={{}}>
          <Suspense fallback={<span>Loading</span>}>
            <SignIn />
          </Suspense>
        </I18nClientProvider>,
        {
          onError: (error) => {
            errors.push(error)
          },
        },
      )
      await stream.allReady
      const html = await new Response(stream).text()
      expect(errors).toEqual([])
      return html
    }

    const [english, chineseFallback] = await Promise.all([render('en-US'), render('zh-Hans')])
    expect(english).toContain('<h1>Sign in</h1>')
    expect(chineseFallback).toContain('<h1>Sign in</h1>')
    expect(mocks.loadResource.mock.calls.map(([lng, ns]) => `${lng}/${ns}`).sort()).toEqual([
      'en-US/login',
      'en-US/login',
      'zh-Hans/login',
    ])

    mocks.loadResource.mockImplementation(async (locale: string) => ({
      default: { signBtn: locale === 'zh-Hans' ? '登录' : 'Sign in' },
    }))
    const [nextEnglish, chinese] = await Promise.all([render('en-US'), render('zh-Hans')])
    expect(nextEnglish).toContain('<h1>Sign in</h1>')
    expect(nextEnglish).not.toContain('登录')
    expect(chinese).toContain('<h1>登录</h1>')
  })
})

function Shell() {
  const { t } = useTranslation(['common'])
  return <header>{t(($) => $['operation.save'])}</header>
}

it('renders the shell from empty resources without a surrounding Suspense boundary', async () => {
  mocks.loadResource.mockReset()
  mocks.loadResource.mockResolvedValue({ default: { 'operation.save': 'Save' } })
  const stream = await renderToReadableStream(
    <I18nClientProvider locale="en-US" resource={{}}>
      <Shell />
    </I18nClientProvider>,
  )
  await stream.allReady
  expect(await new Response(stream).text()).toContain('<header>Save</header>')
  expect(mocks.loadResource.mock.calls).toEqual([['en-US', 'common']])
})
