import { FeaturesProvider } from '../index'

describe('features index exports', () => {
  it('should export FeaturesProvider from the barrel file', () => {
    expect(FeaturesProvider).toBeDefined()
  })
})
