import type { Features } from './types'
import { createStore } from 'zustand'
import { Resolution, TransferMethod } from '@/types/app'

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
      moreLikeThis: {
        enabled: false,
      },
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
          detail: Resolution.high,
          number_limits: 3,
          transfer_methods: [TransferMethod.local_file, TransferMethod.remote_url],
        },
      },
      annotationReply: {
        enabled: false,
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
