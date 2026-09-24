import { act, render, screen } from '@testing-library/react'
import { Suspense } from 'react'
import { ModelSelectorSearchHeader } from '@/app/components/header/account-setting/model-provider-page/model-selector/popup-layout'
import { I18nClientProvider } from '@/app/components/provider/i18n'
import { changeLanguage } from '../client'
import english from '../locales/en-US/model-provider.json'
import chinese from '../locales/zh-Hans/model-provider.json'

vi.unmock('react-i18next')
const mocks = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('../load-resource', () => ({ loadI18nResource: mocks.load }))

it('loads model search copy without dataset settings or app resources and switches its locale', async () => {
  const { loadI18nResource } =
    await vi.importActual<typeof import('../load-resource')>('../load-resource')
  mocks.load.mockImplementation(loadI18nResource)
  render(
    <I18nClientProvider locale="en-US" resource={{}}>
      <Suspense fallback={<span>Loading search</span>}>
        <ModelSelectorSearchHeader inputValue="" onInputValueChange={() => {}} />
      </Suspense>
    </I18nClientProvider>,
  )
  expect(await screen.findByRole('searchbox', { name: english['form.searchModel'] })).toBeVisible()
  expect(mocks.load.mock.calls.map(([locale, ns]) => `${locale}/${ns}`).sort()).toEqual([
    'en-US/common',
    'en-US/modelProvider',
  ])

  mocks.load.mockClear()
  await act(() => changeLanguage('zh-Hans'))
  expect(await screen.findByRole('searchbox', { name: chinese['form.searchModel'] })).toBeVisible()
  expect(mocks.load.mock.calls.map(([locale, ns]) => `${locale}/${ns}`).sort()).toEqual([
    'zh-Hans/common',
    'zh-Hans/modelProvider',
  ])
})
