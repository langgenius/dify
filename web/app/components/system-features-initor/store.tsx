import { create } from 'zustand'
import type { SystemFeatures } from '@/types/feature'

type StateAndAction = {
  systemFeatures: SystemFeatures
  setSystemFeatures: (features: SystemFeatures) => void
}

export const useSystemFeaturesStore = create<StateAndAction>(set => ({
  systemFeatures: {
    sso_enforced_for_signin: false,
    sso_enforced_for_signin_protocol: '',
    sso_enforced_for_web: false,
    sso_enforced_for_web_protocol: '',
    expired_at: 11,
  },
  setSystemFeatures: features => set({ systemFeatures: features }),
}))
