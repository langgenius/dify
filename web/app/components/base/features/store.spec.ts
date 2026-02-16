import { Resolution, TransferMethod } from '@/types/app'
import { createFeaturesStore } from './store'

describe('createFeaturesStore', () => {
  describe('Default State', () => {
    it('should create a store with moreLikeThis disabled by default', () => {
      const store = createFeaturesStore()
      const state = store.getState()

      expect(state.features.moreLikeThis?.enabled).toBe(false)
    })

    it('should create a store with opening disabled by default', () => {
      const store = createFeaturesStore()
      const state = store.getState()

      expect(state.features.opening?.enabled).toBe(false)
    })

    it('should create a store with suggested disabled by default', () => {
      const store = createFeaturesStore()
      const state = store.getState()

      expect(state.features.suggested?.enabled).toBe(false)
    })

    it('should create a store with text2speech disabled by default', () => {
      const store = createFeaturesStore()
      const state = store.getState()

      expect(state.features.text2speech?.enabled).toBe(false)
    })

    it('should create a store with speech2text disabled by default', () => {
      const store = createFeaturesStore()
      const state = store.getState()

      expect(state.features.speech2text?.enabled).toBe(false)
    })

    it('should create a store with citation disabled by default', () => {
      const store = createFeaturesStore()
      const state = store.getState()

      expect(state.features.citation?.enabled).toBe(false)
    })

    it('should create a store with moderation disabled by default', () => {
      const store = createFeaturesStore()
      const state = store.getState()

      expect(state.features.moderation?.enabled).toBe(false)
    })

    it('should create a store with annotationReply disabled by default', () => {
      const store = createFeaturesStore()
      const state = store.getState()

      expect(state.features.annotationReply?.enabled).toBe(false)
    })
  })

  describe('File Image Initialization', () => {
    it('should initialize file image enabled as false', () => {
      const store = createFeaturesStore()
      const { features } = store.getState()

      expect(features.file?.image?.enabled).toBe(false)
    })

    it('should initialize file image detail as high resolution', () => {
      const store = createFeaturesStore()
      const { features } = store.getState()

      expect(features.file?.image?.detail).toBe(Resolution.high)
    })

    it('should initialize file image number_limits as 3', () => {
      const store = createFeaturesStore()
      const { features } = store.getState()

      expect(features.file?.image?.number_limits).toBe(3)
    })

    it('should initialize file image transfer_methods with local and remote options', () => {
      const store = createFeaturesStore()
      const { features } = store.getState()

      expect(features.file?.image?.transfer_methods).toEqual([
        TransferMethod.local_file,
        TransferMethod.remote_url,
      ])
    })
  })

  describe('Feature Merging', () => {
    it('should merge initial moreLikeThis enabled state', () => {
      const store = createFeaturesStore({
        features: {
          moreLikeThis: { enabled: true },
        },
      })
      const { features } = store.getState()

      expect(features.moreLikeThis?.enabled).toBe(true)
    })

    it('should merge initial opening enabled state', () => {
      const store = createFeaturesStore({
        features: {
          opening: { enabled: true },
        },
      })
      const { features } = store.getState()

      expect(features.opening?.enabled).toBe(true)
    })

    it('should preserve additional properties when merging', () => {
      const store = createFeaturesStore({
        features: {
          opening: { enabled: true, opening_statement: 'Hello!' },
        },
      })
      const { features } = store.getState()

      expect(features.opening?.enabled).toBe(true)
      expect(features.opening?.opening_statement).toBe('Hello!')
    })
  })

  describe('setFeatures', () => {
    it('should update moreLikeThis feature via setFeatures', () => {
      const store = createFeaturesStore()

      store.getState().setFeatures({
        moreLikeThis: { enabled: true },
      })

      expect(store.getState().features.moreLikeThis?.enabled).toBe(true)
    })

    it('should update multiple features via setFeatures', () => {
      const store = createFeaturesStore()

      store.getState().setFeatures({
        moreLikeThis: { enabled: true },
        opening: { enabled: true },
      })

      expect(store.getState().features.moreLikeThis?.enabled).toBe(true)
      expect(store.getState().features.opening?.enabled).toBe(true)
    })
  })

  describe('showFeaturesModal', () => {
    it('should initialize showFeaturesModal as false', () => {
      const store = createFeaturesStore()

      expect(store.getState().showFeaturesModal).toBe(false)
    })

    it('should toggle showFeaturesModal to true', () => {
      const store = createFeaturesStore()

      store.getState().setShowFeaturesModal(true)

      expect(store.getState().showFeaturesModal).toBe(true)
    })

    it('should toggle showFeaturesModal to false', () => {
      const store = createFeaturesStore()
      store.getState().setShowFeaturesModal(true)

      store.getState().setShowFeaturesModal(false)

      expect(store.getState().showFeaturesModal).toBe(false)
    })
  })
})
