import type { Plugin } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import { codeInspectorPlugin } from 'code-inspector-plugin'
import { injectClientSnippet, normalizeViteModuleId } from './utils.ts'

type CodeInspectorPluginOptions = {
  injectTarget: string
  port?: number
}

type ForceInspectorClientInjectionPluginOptions = CodeInspectorPluginOptions & {
  projectRoot: string
}

export const createCodeInspectorPlugin = ({
  injectTarget,
  port = 5678,
}: CodeInspectorPluginOptions): Plugin => {
  return codeInspectorPlugin({
    bundler: 'vite',
    port,
    injectTo: injectTarget,
    exclude: [/^(?!.*\.(?:js|ts|mjs|mts|jsx|tsx|vue|svelte|html)(?:$|\?)).*/],
  }) as Plugin
}

const getInspectorRuntimeSnippet = (runtimeFile: string): string => {
  if (!fs.existsSync(runtimeFile))
    return ''

  const raw = fs.readFileSync(runtimeFile, 'utf-8')

  // Strip the helper component default export to avoid duplicate default exports after injection.
  return raw.replace(
    /\s*export default function CodeInspectorEmptyElement\(\)\s*\{[\s\S]*$/,
    '',
  )
}

export const createForceInspectorClientInjectionPlugin = ({
  injectTarget,
  port = 5678,
  projectRoot,
}: ForceInspectorClientInjectionPluginOptions): Plugin => {
  const runtimeFile = path.resolve(
    projectRoot,
    `node_modules/code-inspector-plugin/dist/append-code-${port}.js`,
  )
  const clientSnippet = getInspectorRuntimeSnippet(runtimeFile)

  return {
    name: 'vinext-force-code-inspector-client',
    apply: 'serve',
    enforce: 'pre',
    transform(code, id) {
      if (!clientSnippet)
        return null

      const cleanId = normalizeViteModuleId(id)
      if (cleanId !== injectTarget)
        return null

      const nextCode = injectClientSnippet(code, 'code-inspector-component', clientSnippet)
      if (nextCode === code)
        return null

      return { code: nextCode, map: null }
    },
  }
}
