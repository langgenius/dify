import { namespaces } from './resources'
import { getInitOptions } from './settings'

describe('getInitOptions', () => {
  it('should return the shared i18next defaults for Dify', () => {
    expect(getInitOptions()).toMatchObject({
      load: 'currentOnly',
      fallbackLng: 'en-US',
      showSupportNotice: false,
      partialBundledLanguages: true,
      keySeparator: false,
      ns: namespaces,
      interpolation: {
        escapeValue: false,
      },
    })
  })
})
