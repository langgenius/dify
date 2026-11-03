import { createFeaturesStore } from '../store'

it('restores persisted feature configuration and replaces it without leaking settings across apps', () => {
  const persisted = {
    opening: { enabled: true, opening_statement: 'Hello!' },
    citation: { enabled: true },
  }
  const first = createFeaturesStore({ features: persisted })
  const second = createFeaturesStore()
  expect(first.getState().features).toEqual(persisted)
  const replacement = { opening: { enabled: false }, moreLikeThis: { enabled: true } }
  first.getState().setFeatures(replacement)
  expect(first.getState().features).toEqual(replacement)
  expect(second.getState().features.moreLikeThis?.enabled).toBe(false)
  expect(second.getState().features.opening?.enabled).toBe(false)
})
