import { createStore } from 'zustand'
import type { Features } from './types'
import { TransferMethod } from '@/types/app'

export type FeaturesModal = {
  showFeaturesModal: boolean
  setShowFeaturesModal: (showFeaturesModal: boolean) => void
}

export type FeaturesState = {
  features: Features
}

export type FeaturesAction = {
  setFeatures: (features: Features) => void
}

export type FeatureStoreState = FeaturesState & FeaturesAction & FeaturesModal

export type FeaturesStore = ReturnType<typeof createFeaturesStore>

export const createFeaturesStore = (initProps?: Partial<FeaturesState>) => {
  const DEFAULT_PROPS: FeaturesState = {
    features: {
      opening: {
        enabled: false,
      },
      suggested: {
        enabled: false,
      },
      text2speech: {
        enabled: false,
      },
      speech2text: {
        enabled: false,
      },
      citation: {
        enabled: false,
      },
      moderation: {
        enabled: false,
      },
      file: {
        image: {
          enabled: false,
          number_limits: 3,
          transfer_methods: [TransferMethod.local_file, TransferMethod.remote_url],
        },
      },
    },
  }
  return createStore<FeatureStoreState>()(set => ({
    ...DEFAULT_PROPS,
    ...initProps,
    setFeatures: features => set(() => ({ features })),
    showFeaturesModal: false,
    setShowFeaturesModal: showFeaturesModal => set(() => ({ showFeaturesModal })),
  }))
}
