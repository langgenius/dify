import type { Plugin } from 'vite'
import fs from 'node:fs'
import { injectClientSnippet, normalizeViteModuleId } from './utils.ts'

type CustomI18nHmrPluginOptions = {
  injectTarget: string
}

export const customI18nHmrPlugin = ({ injectTarget }: CustomI18nHmrPluginOptions): Plugin => {
  const i18nHmrClientMarker = 'custom-i18n-hmr-client'
  const i18nHmrClientSnippet = `/* ${i18nHmrClientMarker} */
if (import.meta.hot) {
  const getI18nUpdateTarget = (file) => {
    const match = file.match(/[/\\\\]i18n[/\\\\]([^/\\\\]+)[/\\\\]([^/\\\\]+)\\.json$/)
    if (!match)
      return null
    const [, locale, namespaceFile] = match
    return { locale, namespaceFile }
  }

  import.meta.hot.on('i18n-update', async ({ file, content }) => {
    const target = getI18nUpdateTarget(file)
    if (!target)
      return

    const [{ getI18n }, { camelCase }] = await Promise.all([
      import('react-i18next'),
      import('es-toolkit/string'),
    ])

    const i18n = getI18n()
    if (!i18n)
      return
    if (target.locale !== i18n.language)
      return

    let resources
    try {
      resources = JSON.parse(content)
    }
    catch {
      return
    }

    const namespace = camelCase(target.namespaceFile)
    i18n.addResourceBundle(target.locale, namespace, resources, true, true)
    i18n.emit('languageChanged', i18n.language)
  })
}
`

  return {
    name: 'custom-i18n-hmr',
    apply: 'serve',
    handleHotUpdate({ file, server }) {
      if (file.endsWith('.json') && file.includes('/i18n/')) {
        server.ws.send({
          type: 'custom',
          event: 'i18n-update',
          data: {
            file,
            content: fs.readFileSync(file, 'utf-8'),
          },
        })

        return []
      }
    },
    transform(code, id) {
      const cleanId = normalizeViteModuleId(id)
      if (cleanId !== injectTarget)
        return null

      const nextCode = injectClientSnippet(code, i18nHmrClientMarker, i18nHmrClientSnippet)
      if (nextCode === code)
        return null
      return { code: nextCode, map: null }
    },
  }
}
