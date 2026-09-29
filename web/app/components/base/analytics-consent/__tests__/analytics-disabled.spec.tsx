import { render, waitFor } from '@testing-library/react'
import { REGISTRATION_SUCCESS_STORAGE_KEY } from '../../amplitude/registration-session-state'
import {
  coordinateRegistrationConsent,
  rememberRegistrationSuccess,
} from '../../amplitude/registration-tracking'
import { AnalyticsDisabled } from '../analytics-disabled'
import { getAnalyticsConsent, setAnalyticsConsent } from '../consent-store'

describe('AnalyticsDisabled', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    coordinateRegistrationConsent('denied')
    setAnalyticsConsent('granted')
  })

  it('terminally discards a pending registration marker', async () => {
    rememberRegistrationSuccess({ method: 'email' })
    expect(window.sessionStorage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)).not.toBeNull()

    render(<AnalyticsDisabled />)

    await waitFor(() => expect(getAnalyticsConsent()).toBe('disabled'))
    expect(window.sessionStorage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)).toBeNull()
  })
})
