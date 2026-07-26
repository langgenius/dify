import { render, screen, waitFor } from '@testing-library/react'
import { setAnalyticsConsent, useAnalyticsConsent } from '../consent-store'
import { COOKIEYES_CONSENT_UPDATE_EVENT, CookieYesConsentBridge } from '../cookieyes-consent-bridge'

function ConsentProbe() {
  const consent = useAnalyticsConsent()
  return <span>{consent}</span>
}

describe('CookieYesConsentBridge', () => {
  beforeEach(() => {
    document.cookie = 'cookieyes-consent=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
    setAnalyticsConsent('unknown')
  })

  it('hydrates consent from the CookieYes cookie', async () => {
    document.cookie = 'cookieyes-consent=consentid:test,analytics:yes; path=/'

    render(
      <>
        <CookieYesConsentBridge />
        <ConsentProbe />
      </>,
    )

    expect(await screen.findByText('granted')).toBeInTheDocument()
  })

  it('updates consent when CookieYes reports a rejection', async () => {
    document.cookie = 'cookieyes-consent=consentid:test,analytics:yes; path=/'
    render(
      <>
        <CookieYesConsentBridge />
        <ConsentProbe />
      </>,
    )
    expect(await screen.findByText('granted')).toBeInTheDocument()

    document.dispatchEvent(
      new CustomEvent(COOKIEYES_CONSENT_UPDATE_EVENT, {
        detail: { accepted: ['necessary'], rejected: ['analytics'] },
      }),
    )

    await waitFor(() => expect(screen.getByText('denied')).toBeInTheDocument())
  })
})
