import { createInstance } from 'i18next'
import app from '../locales/en-US/app.json'
import common from '../locales/en-US/common.json'
import { getInitOptions } from '../settings'

describe('default translation namespace', () => {
  it.each([
    { namespaces: [] },
    { namespaces: ['common'] },
    { namespaces: ['app', 'common'] },
  ] as const)(
    'resolves implicit selectors in app when preloading $namespaces',
    async ({ namespaces }) => {
      const i18n = createInstance()
      await i18n.init({
        ...getInitOptions(namespaces),
        lng: 'en-US',
        resources: { 'en-US': { app, common } },
      })

      expect(i18n.t(($) => $['gotoAnything.actions.docDesc'])).toBe(
        app['gotoAnything.actions.docDesc'],
      )
      expect(i18n.getFixedT('en-US')(($) => $['gotoAnything.actions.docDesc'])).toBe(
        app['gotoAnything.actions.docDesc'],
      )
      expect(i18n.t(($) => $['operation.save'], { ns: 'common' })).toBe(common['operation.save'])
    },
  )
})
