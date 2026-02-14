import { Resolution, TransferMethod } from '@/types/app'
import { createFeaturesStore } from './store'

describe('createFeaturesStore', () => {
  it('should create a store with default features', () => {
    const store = createFeaturesStore()
    const state = store.getState()

    expect(state.features.moreLikeThis?.enabled).toBe(false)
    expect(state.features.opening?.enabled).toBe(false)
    expect(state.features.suggested?.enabled).toBe(false)
    expect(state.features.text2speech?.enabled).toBe(false)
    expect(state.features.speech2text?.enabled).toBe(false)
    expect(state.features.citation?.enabled).toBe(false)
    expect(state.features.moderation?.enabled).toBe(false)
    expect(state.features.annotationReply?.enabled).toBe(false)
  })

  it('should initialize file image with correct defaults', () => {
    const store = createFeaturesStore()
    const { features } = store.getState()

    expect(features.file?.image?.enabled).toBe(false)
    expect(features.file?.image?.detail).toBe(Resolution.high)
    expect(features.file?.image?.number_limits).toBe(3)
    expect(features.file?.image?.transfer_methods).toEqual([
      TransferMethod.local_file,
      TransferMethod.remote_url,
    ])
  })

  it('should merge initial props with defaults', () => {
    const store = createFeaturesStore({
      features: {
        moreLikeThis: { enabled: true },
        opening: { enabled: true, opening_statement: 'Hello!' },
      },
    })
    const { features } = store.getState()

    expect(features.moreLikeThis?.enabled).toBe(true)
    expect(features.opening?.enabled).toBe(true)
    expect(features.opening?.opening_statement).toBe('Hello!')
  })

  it('should update features via setFeatures', () => {
    const store = createFeaturesStore()

    store.getState().setFeatures({
      moreLikeThis: { enabled: true },
    })

    expect(store.getState().features.moreLikeThis?.enabled).toBe(true)
  })

  it('should initialize showFeaturesModal as false', () => {
    const store = createFeaturesStore()
    expect(store.getState().showFeaturesModal).toBe(false)
  })

  it('should toggle showFeaturesModal', () => {
    const store = createFeaturesStore()

    store.getState().setShowFeaturesModal(true)
    expect(store.getState().showFeaturesModal).toBe(true)

    store.getState().setShowFeaturesModal(false)
    expect(store.getState().showFeaturesModal).toBe(false)
  })
})
