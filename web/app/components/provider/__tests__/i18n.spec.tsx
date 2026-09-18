import type { i18n as I18nInstance, Resource } from 'i18next'
import type { Locale } from '@/i18n-config'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { changeLanguage } from '@/i18n-config/client'
import { I18nClientProvider } from '../i18n'

vi.unmock('react-i18next')

const testResource = {
  'en-US': {
    common: {
      marker: 'English marker',
    },
  },
  'zh-Hans': {
    common: {
      marker: '中文标记',
    },
  },
} satisfies Resource

function TranslationMarker() {
  const { t } = useTranslation('common')
  return <span data-testid="marker">{t('marker' as never)}</span>
}

function CaptureI18n({ onCapture }: { onCapture: (instance: I18nInstance) => void }) {
  const { i18n } = useTranslation()
  const capturedRef = useRef(false)
  useEffect(() => {
    if (capturedRef.current) return
    capturedRef.current = true
    onCapture(i18n)
  }, [i18n, onCapture])
  return <TranslationMarker />
}

function EmbeddedLanguageOverride() {
  useEffect(() => {
    void changeLanguage('zh-Hans' as Locale)
  }, [])
  return <TranslationMarker />
}

function RerenderHost({
  locale,
  resource,
  children,
}: {
  locale: Locale
  resource: Resource
  children: React.ReactNode
}) {
  const [tick, setTick] = useState(0)
  return (
    <div data-tick={tick}>
      <button type="button" onClick={() => setTick((value) => value + 1)}>
        rerender
      </button>
      <I18nClientProvider locale={locale} resource={resource}>
        {children}
      </I18nClientProvider>
    </div>
  )
}

describe('I18nClientProvider', () => {
  it('preserves the i18next instance and runtime language across same-props rerenders', async () => {
    const user = userEvent.setup()
    let firstInstance: I18nInstance | null = null

    render(
      <RerenderHost locale="en-US" resource={testResource}>
        <CaptureI18n
          onCapture={(instance) => {
            if (!firstInstance) firstInstance = instance
          }}
        />
      </RerenderHost>,
    )

    await waitFor(() => {
      expect(firstInstance).not.toBeNull()
    })

    await act(async () => {
      await changeLanguage('zh-Hans')
    })

    await waitFor(() => {
      expect(screen.getByTestId('marker')).toHaveTextContent('中文标记')
    })

    const instanceBeforeRerender = firstInstance

    await user.click(screen.getByRole('button', { name: 'rerender' }))

    await waitFor(() => {
      expect(screen.getByTestId('marker')).toHaveTextContent('中文标记')
    })
    expect(firstInstance).toBe(instanceBeforeRerender)
  })

  it('applies locale prop changes without recreating the instance', async () => {
    let capturedInstance: I18nInstance | null = null

    const { rerender } = render(
      <I18nClientProvider locale="en-US" resource={testResource}>
        <CaptureI18n
          onCapture={(instance) => {
            capturedInstance = instance
          }}
        />
      </I18nClientProvider>,
    )

    await waitFor(() => {
      expect(capturedInstance).not.toBeNull()
    })

    const instanceBeforeLocaleChange = capturedInstance

    rerender(
      <I18nClientProvider locale="zh-Hans" resource={testResource}>
        <CaptureI18n
          onCapture={(instance) => {
            capturedInstance = instance
          }}
        />
      </I18nClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('marker')).toHaveTextContent('中文标记')
    })
    expect(capturedInstance).toBe(instanceBeforeLocaleChange)
  })

  it('keeps share-style language overrides after a parent rerender', async () => {
    const user = userEvent.setup()

    render(
      <RerenderHost locale="en-US" resource={testResource}>
        <EmbeddedLanguageOverride />
      </RerenderHost>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('marker')).toHaveTextContent('中文标记')
    })

    await user.click(screen.getByRole('button', { name: 'rerender' }))

    await waitFor(() => {
      expect(screen.getByTestId('marker')).toHaveTextContent('中文标记')
    })
  })
})
