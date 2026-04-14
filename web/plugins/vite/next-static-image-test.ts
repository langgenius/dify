import type { Plugin } from 'vite'
import path from 'node:path'
import { normalizeViteModuleId } from './utils'

type NextStaticImageTestPluginOptions = {
  projectRoot: string
}

const STATIC_ASSET_RE = /\.(?:svg|png|jpe?g|gif)$/i
const EXCLUDED_QUERY_RE = /[?&](?:raw|url)\b/

export const nextStaticImageTestPlugin = ({ projectRoot }: NextStaticImageTestPluginOptions): Plugin => {
  return {
    name: 'next-static-image-test',
    enforce: 'pre',
    load(id) {
      if (EXCLUDED_QUERY_RE.test(id))
        return null

      const cleanId = normalizeViteModuleId(id)
      if (!cleanId.startsWith(projectRoot) || !STATIC_ASSET_RE.test(cleanId))
        return null

      const relativePath = path.relative(projectRoot, cleanId).split(path.sep).join('/')
      const src = `/__static__/${relativePath}`

      return `export default { src: ${JSON.stringify(src)} }\n`
    },
  }
}
