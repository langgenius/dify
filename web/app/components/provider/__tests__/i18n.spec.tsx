import type { Resource } from 'i18next'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { changeLanguage } from '@/i18n-config/client'
import { I18nClientProvider } from '../i18n'

vi.unmock('react-i18next')

vi.mock('../i18n-route-namespaces', () => ({
  I18nRouteNamespacesSync: () => null,
}))

const testResource = {
  'en-US': {
    common: { marker: 'English marker' },
    explore: { marker: 'Explore marker' },
  },
  'zh-Hans': {
    common: { marker: '中文标记' },
    explore: { marker: '探索标记' },
  },
} satisfies Resource

function TranslationMarker({ namespace }: { namespace: string }) {
  const { t } = useTranslation(namespace)
  return <span data-testid={`${namespace}-marker`}>{t('marker' as never)}</span>
}

describe('I18nClientProvider', () => {
  it('keeps a stable instance across parent rerenders', async () => {
    const user = userEvent.setup()

    function Host() {
      const [tick, setTick] = useState(0)
      return (
        <div data-tick={tick}>
          <button type="button" onClick={() => setTick((value) => value + 1)}>
            rerender
          </button>
          <I18nClientProvider
            locale="en-US"
            resource={testResource}
            initialNamespaces={['common', 'explore']}
          >
            <TranslationMarker namespace="common" />
          </I18nClientProvider>
        </div>
      )
    }

    render(<Host />)
    await changeLanguage('zh-Hans')

    await waitFor(() => {
      expect(screen.getByTestId('common-marker')).toHaveTextContent('中文标记')
    })

    await user.click(screen.getByRole('button', { name: 'rerender' }))

    await waitFor(() => {
      expect(screen.getByTestId('common-marker')).toHaveTextContent('中文标记')
    })
  })

})
