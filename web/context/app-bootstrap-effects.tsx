'use client'

import {
  useSyncAmplitudeIdentity,
  useSyncZendeskFields,
} from './app-context-effects'

export function AppBootstrapEffects() {
  useSyncZendeskFields()
  useSyncAmplitudeIdentity()

  return null
}
