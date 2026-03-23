import { describe, expect, it } from 'vitest'
import AmplitudeProvider, { isAmplitudeEnabled } from './AmplitudeProvider'
import indexDefault, {
  isAmplitudeEnabled as indexIsAmplitudeEnabled,
  resetUser,
  setUserId,
  setUserProperties,
  trackEvent,
} from './index'
import {
  resetUser as utilsResetUser,
  setUserId as utilsSetUserId,
  setUserProperties as utilsSetUserProperties,
  trackEvent as utilsTrackEvent,
} from './utils'

describe('Amplitude index exports', () => {
  it('exports AmplitudeProvider as default', () => {
    expect(indexDefault).toBe(AmplitudeProvider)
  })

  it('exports isAmplitudeEnabled', () => {
    expect(indexIsAmplitudeEnabled).toBe(isAmplitudeEnabled)
  })

  it('exports utils', () => {
    expect(resetUser).toBe(utilsResetUser)
    expect(setUserId).toBe(utilsSetUserId)
    expect(setUserProperties).toBe(utilsSetUserProperties)
    expect(trackEvent).toBe(utilsTrackEvent)
  })
})
