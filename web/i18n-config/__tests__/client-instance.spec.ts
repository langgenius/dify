import { createInstance } from 'i18next'
import { initReactI18next } from 'react-i18next'
import { createI18nextInstance } from '../client'

vi.mock('../load-resource', () => ({
  loadI18nResource: vi.fn(async () => ({ default: { marker: 'loaded' } })),
}))

describe('createI18nextInstance', () => {
  it('initializes with a limited namespace list when provided', () => {
    const instance = createI18nextInstance(
      'en-US',
      { 'en-US': { common: { marker: 'bundled' } } },
      { namespaces: ['common', 'app'] },
    )

    expect(instance.options.ns).toEqual(['common', 'app'])
  })

  it('does not register every namespace when a subset is passed', async () => {
    const full = createInstance()
    await full.use(initReactI18next).init({ lng: 'en-US', ns: ['common', 'app', 'workflow'] })

    const limited = createI18nextInstance(
      'en-US',
      { 'en-US': { common: {} } },
      { namespaces: ['common'] },
    )

    expect(limited.options.ns?.length).toBeLessThan(full.options.ns?.length ?? 0)
  })
})
