// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import {
  checkTranslationGraph as analyzeTranslationGraph,
  createAnalysisContext,
} from '../i18n-analysis/graph'

const checkTranslationGraph = (root: string, modules: ReadonlyMap<string, string>) =>
  analyzeTranslationGraph(
    root,
    modules,
    undefined,
    createAnalysisContext(root, [
      { module: 'i18n/lib.client.ts', exportName: 'useTranslation', namespaceArgument: 0 },
      {
        module: 'i18n/lib.server.ts',
        exportName: 'useTranslation',
        namespaceArgument: 0,
        implementationFunctions: ['getI18nConfig'],
      },
      { module: 'i18n/server.ts', exportName: 'getTranslation', namespaceArgument: 1 },
      {
        module: 'app/route-metadata.ts',
        exportName: 'getRouteMetadata',
        namespaceArgument: 0,
        selectorArgument: 1,
      },
    ]),
  )

let webRoot: string
let modules: Map<string, string>

function writeJson(relativePath: string, value: Record<string, string>) {
  mkdirSync(path.dirname(path.join(webRoot, relativePath)), { recursive: true })
  writeFileSync(path.join(webRoot, relativePath), `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function writeSource(relativePath: string, content: string) {
  modules.set(path.join(webRoot, relativePath), content)
  mkdirSync(path.dirname(path.join(webRoot, relativePath)), { recursive: true })
  writeFileSync(path.join(webRoot, relativePath), content, 'utf8')
}

function sortedUnusedKeysByNamespace(result: ReturnType<typeof checkTranslationGraph>) {
  return Object.fromEntries(
    Object.entries(result.unused).map(([namespace, keys]) => [namespace, [...keys].sort()]),
  )
}

describe('translation graph analysis', () => {
  beforeEach(() => {
    modules = new Map()
    webRoot = mkdtempSync(path.join(tmpdir(), 'dify-i18n-analysis-'))
    mkdirSync(path.join(webRoot, 'node_modules'), { recursive: true })
    symlinkSync(
      path.resolve(import.meta.dirname, '../../../node_modules/react-i18next'),
      path.join(webRoot, 'node_modules/react-i18next'),
    )
    writeSource('placeholder.ts', '')
    writeSource(
      'i18n/server.ts',
      'export function getTranslation(locale: string, ns: string) { return {} }',
    )
    writeFileSync(
      path.join(webRoot, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { paths: { '@/*': [path.join(webRoot, '*')] } } }),
    )
  })

  afterEach(() => {
    rmSync(webRoot, { recursive: true, force: true })
  })

  describe('Usage Analysis', () => {
    it.each(['static', 'dynamic'] as const)(
      'analyzes repository adapter calls with %s namespaces',
      (mode) => {
        writeJson('i18n/locales/en-US/common.json', { used: 'Used', unused: 'Unused' })
        for (const file of ['i18n/lib.client.ts', 'i18n/lib.server.ts', 'app/route-metadata.ts']) {
          writeSource(
            file,
            readFileSync(path.resolve(import.meta.dirname, '../../..', file), 'utf8'),
          )
        }
        writeSource(
          'src/page.ts',
          `
        import { useTranslation as clientTranslation } from '../i18n/lib.client'
        import { useTranslation as serverTranslation } from '../i18n/lib.server'
        import { getRouteMetadata as metadata } from '../app/route-metadata'
        export function page(ns: string) {
          clientTranslation(${mode === 'static' ? "'common'" : 'ns'})
          serverTranslation(${mode === 'static' ? "'common'" : 'ns'})
          return metadata(${mode === 'static' ? "'common'" : 'ns'}, $ => $.used)
        }
      `,
        )
        const result = checkTranslationGraph(webRoot, modules)
        const unknown = result.evidence.filter((item) => item.kind === 'unknown-namespace')
        expect(unknown).toHaveLength(mode === 'static' ? 0 : 3)
        expect(unknown.every((item) => item.file === 'src/page.ts')).toBe(true)
        expect(result.unused).toEqual({ common: ['unused'] })
        expect(result.protectedNamespaces).toEqual([])
        for (const file of ['i18n/lib.client.ts', 'i18n/lib.server.ts', 'app/route-metadata.ts']) {
          expect(result.moduleNamespaces.get(path.join(webRoot, file))).toEqual(new Set())
        }
      },
    )

    it.each(['direct', 'alias', 'barrel'] as const)(
      'supports custom adapters exported through %s exports',
      (kind) => {
        writeJson('i18n/locales/en-US/common.json', {
          used: 'Used',
          other: 'Other',
          unused: 'Unused',
        })
        writeSource(
          'custom/labels.ts',
          `
        import { useTranslation } from 'react-i18next'
        ${kind === 'direct' ? 'export const label' : 'const internal'} = (selector: (source: Record<string, string>) => string, ns: string) => {
          const { t } = useTranslation(ns)
          return t(selector)
        }
        ${kind === 'direct' ? '' : 'export { internal as label }'}
      `,
        )
        writeSource('custom/barrel.ts', `export { label as caption } from './labels'`)
        writeSource(
          'entry.ts',
          `
        import { label as caption } from './custom/labels'
        import * as labels from './custom/labels'
        caption($ => $.used, 'common')
        labels.label($ => $.other, 'common')
      `,
        )
        const unconfigured = analyzeTranslationGraph(webRoot, modules)
        expect(
          unconfigured.evidence.some(
            (item) => item.kind === 'unknown-namespace' && item.file === 'custom/labels.ts',
          ),
        ).toBe(true)
        const configured = analyzeTranslationGraph(
          webRoot,
          modules,
          undefined,
          createAnalysisContext(webRoot, [
            {
              module: kind === 'barrel' ? 'custom/barrel.ts' : 'custom/labels.ts',
              exportName: kind === 'barrel' ? 'caption' : 'label',
              namespaceArgument: 1,
              selectorArgument: 0,
            },
          ]),
        )
        expect(configured.evidence.some((item) => item.kind === 'unknown-namespace')).toBe(false)
        expect(configured.unused).toEqual({ common: ['unused'] })
        expect(configured.protectedNamespaces).toEqual([])
      },
    )

    it('does not exempt unrelated functions or all code in an adapter module', () => {
      writeJson('i18n/locales/en-US/common.json', { unused: 'Unused' })
      writeSource(
        'app/route-metadata.ts',
        `
        import { useTranslation } from 'react-i18next'
        export function other(ns: string) { useTranslation(ns) }
      `,
      )
      writeSource(
        'src/other.ts',
        `
        import { useTranslation } from 'react-i18next'
        export function getRouteMetadata(ns: string) { useTranslation(ns) }
      `,
      )
      const result = checkTranslationGraph(webRoot, modules)
      expect(
        result.evidence
          .filter((item) => item.kind === 'unknown-namespace')
          .map((item) => item.file)
          .sort(),
      ).toEqual(['app/route-metadata.ts', 'src/other.ts'])
    })

    it.each([
      "function load(ns: string) { return useTranslation(ns) }; load('login')",
      "function load(ns = 'login') { return useTranslation(ns) }; load()",
      "function load(...ns: string[]) { return useTranslation(ns) }; load('login')",
      "const ns = ['login'] as const; useTranslation(ns)",
      "let ns = 'app'; ns = 'login'; useTranslation(ns)",
      "const holder = { ns: 'login' }; useTranslation(holder.ns)",
      "function namespace() { return 'login' }; useTranslation(namespace())",
    ])('leaves runtime namespace values unknown: %s', (body) => {
      writeJson('i18n/locales/en-US/app.json', {})
      writeSource('page.ts', `import { useTranslation } from 'react-i18next'; ${body}`)
      const result = checkTranslationGraph(webRoot, modules)
      expect(result.moduleNamespaces.get(path.join(webRoot, 'page.ts'))).toEqual(new Set())
      expect(result.evidence.some((item) => item.kind === 'unknown-namespace')).toBe(true)
    })

    it('keeps known loads and conservatively checks keys for unknown array members', () => {
      writeJson('i18n/locales/en-US/app.json', { used: 'Used', unused: 'Unused' })
      writeJson('i18n/locales/en-US/common.json', { used: 'Used', unused: 'Unused' })
      writeSource(
        'page.ts',
        `
        import { useTranslation } from 'react-i18next'
        export function page(ns: string) {
          const { t } = useTranslation(['login', ns])
          return t('used')
        }
      `,
      )
      const result = checkTranslationGraph(webRoot, modules)
      expect(result.moduleNamespaces.get(path.join(webRoot, 'page.ts'))).toEqual(
        new Set(['login', 'app', 'common']),
      )
      expect(result.evidence.filter((item) => item.kind === 'unknown-namespace')).toHaveLength(1)
      expect(result.unused).toEqual({ app: ['unused'], common: ['unused'] })
    })

    it('preserves a finite key type when an initializer cannot be evaluated', () => {
      writeJson('i18n/locales/en-US/app.json', { used: 'Used', unused: 'Unused' })
      writeSource(
        'entry.ts',
        `
        declare function remote(): any
        export function label(t: (selector: (value: Record<string, string>) => string) => string) {
          const key: 'used' = remote()
          return t($ => $[key])
        }
      `,
      )
      const result = checkTranslationGraph(webRoot, modules)
      expect(result.unused.app).toEqual(['unused'])
      expect(result.protectedNamespaces).toEqual([])
    })

    it('reports unknown namespaces in shorthand options and Trans attributes', () => {
      writeJson('i18n/locales/en-US/app.json', { used: 'Used' })
      writeSource(
        'entry.tsx',
        `
        import { Trans } from 'react-i18next'
        export function label(t: (key: string, options: { ns: string }) => string, ns: string) {
          t('used', { ns })
          return <Trans ns={ns} i18nKey="used" />
        }
      `,
      )
      const result = checkTranslationGraph(webRoot, modules)
      expect(result.evidence.filter((item) => item.kind === 'unknown-namespace')).toHaveLength(2)
    })

    it('reports explicit namespace loads even when no translation key is consumed', () => {
      writeJson('i18n/locales/en-US/app.json', { unused: 'Unused' })
      writeSource(
        'src/page.ts',
        `
        import { useTranslation } from 'react-i18next'
        import { getTranslation } from '@/i18n/server'
        useTranslation(['app', 'common'])
        getTranslation('en-US', 'login')
        export function boundary(requiredNamespaces: ('workflow' | 'dataset')[]) {
          useTranslation([...requiredNamespaces])
        }
        `,
      )
      const result = checkTranslationGraph(webRoot, modules)
      expect([...result.moduleNamespaces.get(path.join(webRoot, 'src/page.ts'))!].sort()).toEqual([
        'app',
        'common',
        'login',
      ])
      expect(result.unused).toEqual({ app: ['unused'] })
    })

    it('resolves const strings but keeps bound arrays and cyclic values unknown', () => {
      writeJson('i18n/locales/en-US/workflow.json', { unused: 'Unused' })
      writeSource(
        'src/namespaces.ts',
        `
        export const workflow = 'workflow'
        export const extras = ['login', workflow] as const
      `,
      )
      writeSource(
        'src/page.ts',
        `
        import { workflow, extras } from './namespaces'
        import { useTranslation } from 'react-i18next'
        import { getTranslation } from '@/i18n/server'
        const shared = ['common', ...extras] as const
        useTranslation([workflow, ...['common']])
        useTranslation(shared)
        const cyclic = [cyclic]
        useTranslation(cyclic)
      `,
      )
      const result = checkTranslationGraph(webRoot, modules)
      expect([...result.moduleNamespaces.get(path.join(webRoot, 'src/page.ts'))!].sort()).toEqual([
        'common',
        'workflow',
      ])
      expect(result.evidence.filter((item) => item.kind === 'unknown-namespace')).toHaveLength(2)
      expect(result.unused).toEqual({ workflow: ['unused'] })
    })

    it('recognizes imported aliases and ignores unrelated same-name functions', () => {
      writeJson('i18n/locales/en-US/app.json', { used: 'Used', unused: 'Unused' })
      writeSource(
        'src/aliases.tsx',
        `
        import { useTranslation as useT, Trans as Translation } from 'react-i18next'
        const load = useT
        load('common')
        export function View() { return <Translation ns="app" i18nKey="used" /> }
        function useTranslation(value: string) { return value }
        function getTranslation(locale: string, value: string) { return value }
        useTranslation('unrelated')
        getTranslation('en-US', 'also-unrelated')
      `,
      )
      const result = checkTranslationGraph(webRoot, modules)
      expect(
        [...result.moduleNamespaces.get(path.join(webRoot, 'src/aliases.tsx'))!].sort(),
      ).toEqual(['app', 'common'])
      expect(result.unused).toEqual({ app: ['unused'] })
    })

    it('follows API re-exports and namespace imports through their declarations', () => {
      writeJson('i18n/locales/en-US/app.json', { unused: 'Unused' })
      writeSource('i18n/lib.client.ts', `export function useTranslation(ns: string) { return ns }`)
      writeSource('src/barrel.ts', `export { useTranslation as useT } from '../i18n/lib.client'`)
      writeSource(
        'src/page.ts',
        `
        import { useT } from './barrel'
        import * as reactI18n from 'react-i18next'
        useT('login')
        reactI18n.useTranslation('common')
      `,
      )
      const result = checkTranslationGraph(webRoot, modules)
      expect([...result.moduleNamespaces.get(path.join(webRoot, 'src/page.ts'))!].sort()).toEqual([
        'common',
        'login',
      ])
    })

    it('reports dynamic protection with the originating module and line', () => {
      writeJson('i18n/locales/en-US/app.json', { dynamic: 'Dynamic' })
      writeSource(
        'src/dynamic.ts',
        `export function label(t: (key: string) => string, key: string) {
  return t(key)
}`,
      )
      const result = checkTranslationGraph(webRoot, modules)
      expect(result.evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'dynamic-key',
            file: 'src/dynamic.ts',
            line: 2,
            namespaces: ['app'],
          }),
        ]),
      )
      expect(result.unused).toEqual({})
    })

    it('resolves generic metadata selectors using the namespace at each call site', () => {
      writeJson('i18n/locales/en-US/app.json', { resetPassword: 'Unused app key' })
      writeJson('i18n/locales/en-US/login.json', {
        resetPassword: 'Reset password',
        unused: 'Unused',
      })
      writeJson('i18n/locales/en-US/common.json', { title: 'Title', unused: 'Unused' })
      writeSource(
        'src/metadata.ts',
        `
        type Namespace = 'app' | 'login' | 'common'
        type SelectorParam<T extends Namespace> = (source: Record<string, string>) => string
        export declare function getRouteMetadata<T extends Namespace>(namespace: T, selector: SelectorParam<T>): string
      `,
      )
      writeSource(
        'src/page.ts',
        `
        import { getRouteMetadata } from './metadata'
        export const login = getRouteMetadata('login', $ => $.resetPassword)
        const getTitle = getRouteMetadata
        export const common = getTitle<'common'>('common', $ => $.title)
      `,
      )

      expect(checkTranslationGraph(webRoot, modules).unused).toEqual({
        app: ['resetPassword'],
        login: ['unused'],
        common: ['unused'],
      })
    })

    it('keeps possible matches across namespaces when a selector namespace cannot be resolved', () => {
      writeJson('i18n/locales/en-US/app.json', { title: 'App', unused: 'Unused' })
      writeJson('i18n/locales/en-US/login.json', { title: 'Login', unused: 'Unused' })
      writeSource(
        'src/metadata.ts',
        `
        type SelectorParam<T> = (source: Record<string, string>) => string
        declare function metadata<T>(namespace: T, selector: SelectorParam<T>): string
        export function page<T>(namespace: T) {
          return metadata(namespace, $ => $.title)
        }
      `,
      )

      expect(checkTranslationGraph(webRoot, modules).unused).toEqual({
        app: ['unused'],
        login: ['unused'],
      })
    })

    it('protects every possible namespace when the namespace is dynamic', () => {
      writeJson('i18n/locales/en-US/app.json', { used: 'App' })
      writeJson('i18n/locales/en-US/common.json', { used: 'Common' })
      writeSource(
        'src/dynamic-namespace.ts',
        `
        import { useTranslation } from 'react-i18next'
        export function label(namespace: string, key: string) {
          const { t } = useTranslation(['app', namespace])
          return t($ => $[key])
        }
      `,
      )

      const result = checkTranslationGraph(webRoot, modules)

      expect(result.protectedNamespaces).toEqual(['app', 'common'])
      expect(result.unused).toEqual({})
    })

    it('matches dynamically namespaced keys without keeping unrelated keys', () => {
      writeJson('i18n/locales/en-US/app.json', { used: 'App', unused: 'Unused' })
      writeJson('i18n/locales/en-US/common.json', { used: 'Common', unused: 'Unused' })
      writeSource(
        'src/dynamic-namespace.ts',
        `
        import { useTranslation } from 'react-i18next'
        export function label(namespace: string) {
          const { t } = useTranslation()
          return t(\`\${namespace}:used\`)
        }
      `,
      )

      expect(checkTranslationGraph(webRoot, modules).unused).toEqual({
        app: ['unused'],
        common: ['unused'],
      })
    })

    it('should keep flat keys selected by t and Trans', () => {
      // Arrange
      writeJson('i18n/locales/en-US/app.json', {
        'account.changeEmail.title': 'Change email',
        'account.changeEmail.description': 'Description',
        'account.changeEmail.unused': 'Unused',
      })
      writeSource(
        'src/selectors.tsx',
        `
        import { Trans, useTranslation } from 'react-i18next'

        export function SelectorExample() {
          const { t } = useTranslation('app')
          const title = t($ => $['account.changeEmail.title'])

          return (
            <Trans
              i18nKey={$ => $['account.changeEmail.description']}
              ns="app"
            >
              {title}
            </Trans>
          )
        }
      `,
      )

      // Act
      const result = checkTranslationGraph(webRoot, modules)

      // Assert
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        app: ['account.changeEmail.unused'],
      })
    })

    it('should use the default namespace for unresolved selectors', () => {
      // Arrange
      writeJson('i18n/locales/en-US/app.json', {
        'dynamic.app': 'Dynamic app key',
      })
      writeJson('i18n/locales/en-US/common.json', {
        'unused.common': 'Unused common key',
      })
      writeSource(
        'src/default-namespace.tsx',
        `
        import { useTranslation } from 'react-i18next'

        export function DefaultNamespaceExample(key: string) {
          const { t } = useTranslation()
          return t($ => $[key])
        }
      `,
      )

      // Act
      const result = checkTranslationGraph(webRoot, modules)

      // Assert
      expect(result.protectedNamespaces).toEqual(['app'])
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        common: ['unused.common'],
      })
    })

    it('should resolve selectors stored in variables', () => {
      // Arrange
      writeJson('i18n/locales/en-US/app.json', {
        members_one: '1 member',
        members_other: '{{count}} members',
        unused: 'Unused',
      })
      writeSource(
        'src/selector-variable.ts',
        `
        import type { SelectorParam } from 'i18next'
        import { createInstance } from 'i18next'

        const instance = createInstance()
        const memberKey: SelectorParam<'app'> = $ => $['members']
        instance.t(memberKey, { count: 2 })
      `,
      )

      // Act
      const result = checkTranslationGraph(webRoot, modules)

      // Assert
      expect(result.protectedNamespaces).toEqual([])
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        app: ['unused'],
      })
    })

    it('should resolve finite selector maps with computed keys and optional entries', () => {
      // Arrange
      writeJson('i18n/locales/en-US/app.json', {
        first: 'First',
        second: 'Second',
        unused: 'Unused',
      })
      writeSource(
        'src/selector-map.ts',
        `
        import type { SelectorParam } from 'i18next'
        import { useTranslation } from 'react-i18next'

        enum Mode {
          First = 'first',
          Second = 'second',
        }

        const selectors: Record<Mode, SelectorParam<'app'>> = {
          [Mode.First]: $ => $.first,
          [Mode.Second]: $ => $['second'],
        }

        export function SelectorMapExample(mode: Mode, enabled: boolean) {
          const { t } = useTranslation()
          const selector = enabled ? selectors[mode] : undefined
          return selector ? t(selector) : null
        }
      `,
      )

      // Act
      const result = checkTranslationGraph(webRoot, modules)

      // Assert
      expect(result.protectedNamespaces).toEqual([])
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        app: ['unused'],
      })
    })

    it('should protect a selector map namespace when any candidate is unresolved', () => {
      // Arrange
      writeJson('i18n/locales/en-US/app.json', {
        hidden: 'Potentially used by the dynamic selector',
        used: 'Used',
      })
      writeSource(
        'src/mixed-selector-map.ts',
        `
        import type { SelectorParam } from 'i18next'
        import { useTranslation } from 'react-i18next'

        export function MixedSelectorMapExample(kind: string, dynamic: SelectorParam<'app'>) {
          const { t } = useTranslation()
          const selectors = {
            known: $ => $['used'],
            dynamic,
          }
          return t(selectors[kind as keyof typeof selectors])
        }
      `,
      )

      // Act
      const result = checkTranslationGraph(webRoot, modules)

      // Assert
      expect(result.protectedNamespaces).toEqual(['app'])
      expect(sortedUnusedKeysByNamespace(result)).toEqual({})
    })

    it('should protect known selector properties that dynamic entries can override', () => {
      // Arrange
      writeJson('i18n/locales/en-US/app.json', {
        hidden: 'Potentially used by the dynamic selector',
        used: 'Used',
      })
      writeSource(
        'src/overridden-selector-map.ts',
        `
        import type { SelectorParam } from 'i18next'
        import { useTranslation } from 'react-i18next'

        export function ComputedOverrideExample(dynamicKey: string, dynamic: SelectorParam<'app'>) {
          const { t } = useTranslation()
          const selectors = {
            known: $ => $['used'],
            [dynamicKey]: dynamic,
          }
          return t(selectors.known)
        }

        export function SpreadOverrideExample(dynamicMap: Record<string, SelectorParam<'app'>>) {
          const { t } = useTranslation()
          const selectors = {
            known: $ => $['used'],
            ...dynamicMap,
          }
          return t(selectors.known)
        }
      `,
      )

      // Act
      const result = checkTranslationGraph(webRoot, modules)

      // Assert
      expect(result.protectedNamespaces).toEqual(['app'])
      expect(sortedUnusedKeysByNamespace(result)).toEqual({})
    })

    it('should resolve statically computed selector map properties', () => {
      // Arrange
      writeJson('i18n/locales/en-US/app.json', {
        unused: 'Unused',
        used: 'Used',
      })
      writeSource(
        'src/computed-selector-map.ts',
        `
        import { useTranslation } from 'react-i18next'

        const property = 'label'
        const selectors = {
          [property]: $ => $['used'],
        }

        export function ComputedSelectorMapExample() {
          const { t } = useTranslation()
          return t(selectors[property])
        }
      `,
      )

      // Act
      const result = checkTranslationGraph(webRoot, modules)

      // Assert
      expect(result.protectedNamespaces).toEqual([])
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        app: ['unused'],
      })
    })

    it('should ignore dotted literals passed to unrelated generic functions', () => {
      // Arrange
      writeJson('i18n/locales/en-US/app.json', {
        used: 'Used',
        unused: 'Unused',
      })
      writeSource(
        'src/unrelated-generic.ts',
        `
        import { useTranslation } from 'react-i18next'

        const identity = <Value>(value: Value) => value

        export function GenericExample() {
          const { t } = useTranslation('app')
          identity('not.a.translation.key')
          return t($ => $['used'])
        }
      `,
      )

      // Act
      const result = checkTranslationGraph(webRoot, modules)

      // Assert
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        app: ['unused'],
      })
    })

    it('should analyze translation adapter consumers without protecting their namespace', () => {
      // Arrange
      writeJson('i18n/locales/en-US/app.json', {
        used: 'Used',
        unused: 'Unused',
      })
      writeSource(
        'src/translation-adapter.ts',
        `
        import type { SelectorParam } from 'i18next'
        import { useTranslation } from 'react-i18next'

        type Translate = (selector: SelectorParam<'app'>) => string

        function renderLabel(translate: Translate) {
          return translate($ => $['used'])
        }

        export function AdapterExample() {
          const { t } = useTranslation()
          const translate: Translate = selector => t(selector)
          return renderLabel(translate)
        }
      `,
      )

      // Act
      const result = checkTranslationGraph(webRoot, modules)

      // Assert
      expect(result.protectedNamespaces).toEqual([])
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        app: ['unused'],
      })
    })

    it('should infer the namespace of a typed destructured translation parameter', () => {
      // Arrange
      writeJson('i18n/locales/en-US/app.json', {
        'unused.app': 'Unused app key',
      })
      writeJson('i18n/locales/en-US/deployments.json', {
        unused: 'Unused deployment key',
        'versions.deployTo': 'Deploy to {{name}}',
      })
      writeSource(
        'src/destructured-translation.ts',
        `
        import type { SelectorParam } from 'i18next'

        type DeploymentTranslate = <Selector extends SelectorParam<'deployments'>>(
          selector: Selector,
          options?: Record<string, unknown>,
        ) => string

        export function buildLabel({ t }: { t: DeploymentTranslate }) {
          return t($ => $['versions.deployTo'], { name: 'Production' })
        }
      `,
      )

      // Act
      const result = checkTranslationGraph(webRoot, modules)

      // Assert
      expect(result.protectedNamespaces).toEqual([])
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        app: ['unused.app'],
        deployments: ['unused'],
      })
    })

    it('should prefer checker namespaces for a translation parameter named t', () => {
      // Arrange
      writeJson('i18n/locales/en-US/agent-v-2.json', {
        'agentDetail.used': 'Used agent key',
        'agentDetail.unused': 'Unused agent key',
      })
      writeJson('i18n/locales/en-US/app.json', {
        'unused.app': 'Unused app key',
      })
      writeSource(
        'src/named-translation-parameter.ts',
        `
        import type { SelectorParam } from 'i18next'

        type AgentTranslate = <Selector extends SelectorParam<'agentV2'>>(
          selector: Selector,
        ) => string

        export function buildLabel(t: AgentTranslate) {
          return t($ => $['agentDetail.used'])
        }
      `,
      )

      // Act
      const result = checkTranslationGraph(webRoot, modules)

      // Assert
      expect(result.protectedNamespaces).toEqual([])
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        agentV2: ['agentDetail.unused'],
        app: ['unused.app'],
      })
    })

    it('should infer branded TFunction namespaces for direct and destructured parameters', () => {
      // Arrange
      writeJson('i18n/locales/en-US/agent-v-2.json', {
        'agentDetail.direct': 'Direct use',
        'agentDetail.destructured': 'Destructured use',
        'agentDetail.unused': 'Unused agent key',
      })
      writeJson('i18n/locales/en-US/app.json', {
        'unused.app': 'Unused app key',
      })
      writeSource(
        'src/branded-translation-parameter.ts',
        `
        type AgentTranslate = {
          readonly $TFunctionBrand: 'agentV2'
          (selector: (source: Record<string, string>) => string): string
        }

        export function directLabel(t: AgentTranslate) {
          return t($ => $['agentDetail.direct'])
        }

        export function destructuredLabel({ t }: { t: AgentTranslate }) {
          return t($ => $['agentDetail.destructured'])
        }
      `,
      )

      // Act
      const result = checkTranslationGraph(webRoot, modules)

      // Assert
      expect(result.protectedNamespaces).toEqual([])
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        agentV2: ['agentDetail.unused'],
        app: ['unused.app'],
      })
    })

    it('should ignore typed selector forwarding inside an adapter block body', () => {
      // Arrange
      writeJson('i18n/locales/en-US/app.json', {
        unused: 'Unused',
        used: 'Used',
      })
      writeJson('i18n/locales/en-US/common.json', {
        'unused.common': 'Unused common key',
      })
      writeSource(
        'src/block-body-adapter.ts',
        `
        import type { SelectorParam } from 'i18next'

        type Translate = <Selector extends SelectorParam<'app'>>(
          selector: Selector,
          options: { ns: 'app' },
        ) => string

        const getStringTranslate = (translate: Translate): Translate => {
          return (selector, options) => {
            const result = translate(selector, options)
            if (typeof result !== 'string')
              throw new TypeError('Expected a string')
            return result
          }
        }

        export function renderLabel(translate: Translate) {
          return getStringTranslate(translate)($ => $['used'], { ns: 'app' })
        }
      `,
      )

      // Act
      const result = checkTranslationGraph(webRoot, modules)

      // Assert
      expect(result.protectedNamespaces).toEqual([])
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        app: ['unused'],
        common: ['unused.common'],
      })
    })

    it('should ignore a named adapter forwarding its typed selector parameter', () => {
      // Arrange
      writeJson('i18n/locales/en-US/workflow.json', {
        unused: 'Unused',
        used: 'Used',
      })
      writeSource(
        'src/named-selector-adapter.ts',
        `
        import type { SelectorParam } from 'i18next'

        type Translate = <Selector extends SelectorParam<'workflow'>>(
          selector: Selector,
          options: { ns: 'workflow' },
        ) => string

        const translateString = <Selector extends SelectorParam<'workflow'>>(
          translate: Translate,
          selector: Selector,
        ): string => {
          const result = translate(selector, { ns: 'workflow' })
          if (typeof result !== 'string')
            throw new TypeError('Expected a string')
          return result
        }

        export function renderLabel(translate: Translate) {
          return translateString(translate, $ => $['used'])
        }
      `,
      )

      // Act
      const result = checkTranslationGraph(webRoot, modules)

      // Assert
      expect(result.protectedNamespaces).toEqual([])
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        workflow: ['unused'],
      })
    })

    it('should resolve a selected field from nested selector map entries', () => {
      // Arrange
      writeJson('i18n/locales/en-US/plugin.json', {
        'source.first': 'First source',
        'source.second': 'Second source',
        unused: 'Unused',
      })
      writeSource(
        'src/nested-selector-map.ts',
        `
        import type { SelectorParam } from 'i18next'
        import { useTranslation } from 'react-i18next'

        enum Source {
          First = 'first',
          Second = 'second',
        }

        type SourceConfig = {
          icon: unknown
          tipSelector: SelectorParam<'plugin'>
        }

        const sourceConfigs: Record<Source, SourceConfig> = {
          [Source.First]: {
            icon: createIcon('first'),
            tipSelector: $ => $['source.first'],
          },
          [Source.Second]: {
            icon: createIcon('second'),
            tipSelector: $ => $['source.second'],
          },
        }

        declare function createIcon(name: string): unknown

        export function SourceLabel(source: Source) {
          const { t } = useTranslation()
          const config = sourceConfigs[source]
          return t(config.tipSelector, { ns: 'plugin' })
        }
      `,
      )

      // Act
      const result = checkTranslationGraph(webRoot, modules)

      // Assert
      expect(result.protectedNamespaces).toEqual([])
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        plugin: ['unused'],
      })
    })

    it('should conservatively protect untyped JavaScript translation adapters', () => {
      // Arrange
      writeJson('i18n/locales/en-US/app.json', {
        hidden: 'Potentially used',
        used: 'Used',
      })
      writeSource(
        'src/untyped-adapter.js',
        `
        import { useTranslation } from 'react-i18next'

        export function UntypedAdapter() {
          const { t } = useTranslation()
          const translate = selector => t(selector)
          return translate($ => $['used'])
        }
      `,
      )

      // Act
      const result = checkTranslationGraph(webRoot, modules)

      // Assert
      expect(result.protectedNamespaces).toEqual(['app'])
      expect(sortedUnusedKeysByNamespace(result)).toEqual({})
    })

    it('should protect the selected namespace for an open string-key adapter', () => {
      // Arrange
      writeJson('i18n/locales/en-US/app.json', {
        'unused.app': 'Unused app',
      })
      writeJson('i18n/locales/en-US/permission-keys.json', {
        'server.permission': 'Server permission',
      })
      writeSource(
        'src/open-key-adapter.ts',
        `
        import type { SelectorKey } from 'i18next'
        import { useTranslation } from 'react-i18next'

        export function OpenKeyAdapter() {
          const { t } = useTranslation()
          return (key: string) => t(key as SelectorKey, { ns: 'permissionKeys' })
        }
      `,
      )

      // Act
      const result = checkTranslationGraph(webRoot, modules)

      // Assert
      expect(result.protectedNamespaces).toEqual(['permissionKeys'])
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        app: ['unused.app'],
      })
    })

    it('should keep keys matching a dynamic selector pattern', () => {
      // Arrange
      writeJson('i18n/locales/en-US/plugin.json', {
        'voice.language.enUS': 'English',
        'voice.language.zhCN': 'Chinese',
        unrelated: 'Unrelated',
      })
      writeSource(
        'src/dynamic-selector.tsx',
        `
        import { useTranslation } from 'react-i18next'

        export function DynamicSelectorExample(language: string) {
          const { t } = useTranslation('plugin')
          return t($ => $[\`voice.language.\${language}\`])
        }
      `,
      )

      // Act
      const result = checkTranslationGraph(webRoot, modules)

      // Assert
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        plugin: ['unrelated'],
      })
    })

    it('should keep selector keys from a typed union', () => {
      // Arrange
      writeJson('i18n/locales/en-US/common.json', {
        'status.ready': 'Ready',
        'status.failed': 'Failed',
        'status.unused': 'Unused',
      })
      writeSource(
        'src/typed-selector.tsx',
        `
        import { useTranslation } from 'react-i18next'

        type StatusKey = 'status.ready' | 'status.failed'

        export function TypedSelectorExample(statusKey: StatusKey) {
          const { t } = useTranslation('common')
          return t($ => $[statusKey])
        }
      `,
      )

      // Act
      const result = checkTranslationGraph(webRoot, modules)

      // Assert
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        common: ['status.unused'],
      })
    })

    it('should keep selector keys from secondary namespaces', () => {
      // Arrange
      writeJson('i18n/locales/en-US/app.json', {
        'unused.app': 'Unused app',
      })
      writeJson('i18n/locales/en-US/common.json', {
        'operation.close': 'Close',
        'unused.common': 'Unused common',
      })
      writeSource(
        'src/multi-namespace-selector.tsx',
        `
        import { useTranslation } from 'react-i18next'

        export function MultiNamespaceSelectorExample() {
          const { t } = useTranslation(['app', 'common'])
          return t($ => $.common['operation.close'])
        }
      `,
      )

      // Act
      const result = checkTranslationGraph(webRoot, modules)

      // Assert
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        app: ['unused.app'],
        common: ['unused.common'],
      })
    })

    it('should keep property and element access selectors from secondary namespaces', () => {
      // Arrange
      writeJson('i18n/locales/en-US/app.json', {
        'unused.app': 'Unused app',
      })
      writeJson('i18n/locales/en-US/common.json', {
        close: 'Close',
        confirm: 'Confirm',
        unused: 'Unused',
      })
      writeSource(
        'src/secondary-selector-access.tsx',
        `
        import { useTranslation } from 'react-i18next'

        export function SecondarySelectorAccessExample() {
          const { t } = useTranslation(['app', 'common'])
          t($ => $.common.close)
          return t($ => $['common']['confirm'])
        }
      `,
      )

      // Act
      const result = checkTranslationGraph(webRoot, modules)

      // Assert
      expect(result.protectedNamespaces).toEqual([])
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        app: ['unused.app'],
        common: ['unused'],
      })
    })

    it('should only protect the selected namespace for an unresolved selector', () => {
      // Arrange
      writeJson('i18n/locales/en-US/app.json', {
        'unused.app': 'Unused app',
      })
      writeJson('i18n/locales/en-US/common.json', {
        'maybe.used': 'Maybe used',
      })
      writeSource(
        'src/unresolved-namespace-selector.tsx',
        `
        import { useTranslation } from 'react-i18next'

        export function UnresolvedNamespaceSelectorExample(keyFromServer: string) {
          const { t } = useTranslation(['app', 'common'])
          return t($ => $.common[keyFromServer])
        }
      `,
      )

      // Act
      const result = checkTranslationGraph(webRoot, modules)

      // Assert
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        app: ['unused.app'],
      })
      expect(result.protectedNamespaces).toEqual(['common'])
    })

    it('should keep literal keys, aliased t functions, ns options, namespace separators, and Trans keys', () => {
      // Arrange
      writeJson('i18n/locales/en-US/app.json', {
        'literal.title': 'Title',
        withDefault: 'With default',
        'trans.shared': 'Shared app',
        'unused.app': 'Unused app',
      })
      writeJson('i18n/locales/en-US/common.json', {
        'operation.close': 'Close',
        'trans.shared': 'Shared common',
        'unused.common': 'Unused common',
      })
      writeSource(
        'src/example.tsx',
        `
        import { Trans, useTranslation } from 'react-i18next'

        export function Example() {
          const { t } = useTranslation('app')
          const { t: tCommon } = useTranslation('common')

          t('literal.title')
          t('withDefault', 'Fallback', { ns: 'app' })
          tCommon('operation.close')
          t('common:operation.close')

          return (
            <>
              <Trans i18nKey="trans.shared" />
              <Trans i18nKey="trans.shared" ns="app" />
            </>
          )
        }
      `,
      )

      // Act
      const result = checkTranslationGraph(webRoot, modules)

      // Assert
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        app: ['unused.app'],
        common: ['trans.shared', 'unused.common'],
      })
    })

    it('should expand resolvable dynamic keys and keep matching prefixes for unresolved dynamic keys', () => {
      // Arrange
      writeJson('i18n/locales/en-US/plugin.json', {
        'notice.fullMessage': 'Full message',
        'notice.reason.bad': 'Bad reason',
        'notice.reason.legacy': 'Legacy reason',
        'voice.language.enUS': 'English',
        'voice.language.zhCN': 'Chinese',
        'voice.language.unused': 'Fallback language',
        unrelated: 'Unrelated',
      })
      writeSource(
        'src/dynamic.tsx',
        `
        import { useTranslation } from 'react-i18next'

        const i18nPrefix = 'notice'
        const deprecatedReasonKey = 'bad'

        export function DynamicExample(language: string) {
          const { t } = useTranslation('plugin')
          t(\`\${i18nPrefix}.fullMessage\`)
          t(\`\${i18nPrefix}.reason.\${deprecatedReasonKey}\`)
          t(\`voice.language.\${language}\`, 'Fallback', { ns: 'plugin' })
        }
      `,
      )

      // Act
      const result = checkTranslationGraph(webRoot, modules)

      // Assert
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        plugin: ['notice.reason.legacy', 'unrelated'],
      })
    })

    it('should protect an entire namespace when a dynamic key has no static prefix', () => {
      // Arrange
      writeJson('i18n/locales/en-US/app.json', {
        'maybe.used': 'Maybe used',
        'otherwise.unused': 'Otherwise unused',
      })
      writeSource(
        'src/unresolved.tsx',
        `
        import { useTranslation } from 'react-i18next'

        export function UnresolvedExample(keyFromServer: string) {
          const { t } = useTranslation('app')
          return t(keyFromServer)
        }
      `,
      )

      // Act
      const result = checkTranslationGraph(webRoot, modules)

      // Assert
      expect(sortedUnusedKeysByNamespace(result)).toEqual({})
      expect(result.protectedNamespaces).toEqual(['app'])
    })

    it('should keep typed key prefixes without protecting the whole namespace', () => {
      // Arrange
      writeJson('i18n/locales/en-US/app-debug.json', {
        'duplicateError.name': 'Name',
        'duplicateError.value': 'Value',
        'outside.unused': 'Outside',
      })
      writeSource(
        'src/typed-prefix.tsx',
        `
        import type { I18nKeysByPrefix } from '@/types/i18n'
        import { useTranslation } from 'react-i18next'

        export function TypedPrefixExample(errorKey: string) {
          const { t } = useTranslation()
          return t(errorKey as I18nKeysByPrefix<'appDebug', 'duplicateError.'>, { ns: 'appDebug' })
        }
      `,
      )

      // Act
      const result = checkTranslationGraph(webRoot, modules)

      // Assert
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        appDebug: ['outside.unused'],
      })
      expect(result.protectedNamespaces).toEqual([])
    })

    it('should expand object map values when indexed with a dynamic key', () => {
      // Arrange
      writeJson('i18n/locales/en-US/common.json', {
        'status.ready': 'Ready',
        'status.failed': 'Failed',
        'status.unused': 'Unused',
      })
      writeSource(
        'src/object-map.tsx',
        `
        import { useTranslation } from 'react-i18next'

        const statusI18nKey = {
          ready: 'status.ready',
          failed: 'status.failed',
        } as const

        export function ObjectMapExample(status: keyof typeof statusI18nKey) {
          const { t } = useTranslation('common')
          return t(statusI18nKey[status])
        }
      `,
      )

      // Act
      const result = checkTranslationGraph(webRoot, modules)

      // Assert
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        common: ['status.unused'],
      })
    })

    it('protects the namespace for keys returned by runtime helpers', () => {
      // Arrange
      writeJson('i18n/locales/en-US/common.json', {
        'mainNav.workspace.searchPlaceholder': 'Search',
        'mainNav.workspace.unused': 'Unused',
      })
      writeSource(
        'src/identity-helper.tsx',
        `
        import { useTranslation } from 'react-i18next'

        const workspaceSwitchI18nKey = (key: string) => key as 'mainNav.workspace.settings'

        export function IdentityHelperExample() {
          const { t } = useTranslation()
          return t($ => $[workspaceSwitchI18nKey('mainNav.workspace.searchPlaceholder')], { ns: 'common' })
        }
      `,
      )

      // Act
      const result = checkTranslationGraph(webRoot, modules)

      // Assert
      expect(sortedUnusedKeysByNamespace(result)).toEqual({})
      expect(result.protectedNamespaces).toEqual(['common'])
    })

    it('should keep i18next plural variants when the base key is referenced', () => {
      // Arrange
      writeJson('i18n/locales/en-US/deployments.json', {
        'overview.environments_one': '1 environment',
        'overview.environments_other': '{{count}} environments',
        'overview.unused_one': '1 unused',
        'overview.unused_other': '{{count}} unused',
      })
      writeSource(
        'src/plural.tsx',
        `
        import { useTranslation } from 'react-i18next'

        export function PluralExample(count: number) {
          const { t } = useTranslation('deployments')
          return t('overview.environments', { count })
        }
      `,
      )

      // Act
      const result = checkTranslationGraph(webRoot, modules)

      // Assert
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        deployments: ['overview.unused_one', 'overview.unused_other'],
      })
    })

    it('should infer plural namespaces from typed TFunction parameters', () => {
      // Arrange
      writeJson('i18n/locales/en-US/deployments.json', {
        'overview.chip.behind_one': '1 release behind',
        'overview.chip.behind_other': '{{count}} releases behind',
        'overview.chip.unused_one': '1 unused',
        'overview.chip.unused_other': '{{count}} unused',
      })
      writeSource(
        'src/typed-t-function.ts',
        `
        import type { TFunction } from 'i18next'

        export function renderStatus(t: TFunction<'deployments'>) {
          return t('overview.chip.behind', { count: 2 })
        }
      `,
      )

      // Act
      const result = checkTranslationGraph(webRoot, modules)

      // Assert
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        deployments: ['overview.chip.unused_one', 'overview.chip.unused_other'],
      })
    })

    it('should keep literals when conditional i18n key types expand into unions', () => {
      // Arrange
      writeJson('i18n/locales/en-US/agent-v-2.json', {
        'agentDetail.configure.tools.credential.authOne': 'Auth 1',
        'agentDetail.configure.tools.unused': 'Unused',
      })
      writeSource(
        'src/typed-key-field.ts',
        `
        type Resources = {
          agentV2: {
            'agentDetail.configure.tools.credential.authOne': string
            'agentDetail.configure.tools.unused': string
          }
        }

        type I18nKeysWithPrefix<Namespace extends keyof Resources, Prefix extends string> =
          Extract<keyof Resources[Namespace], \`\${Prefix}\${string}\`>

        type Tool = {
          credentialKey?: I18nKeysWithPrefix<'agentV2', 'agentDetail.configure.tools.'>
        }

        export function addTool(tools: Tool[], hasCredential: boolean) {
          tools.push({
            credentialKey: hasCredential
              ? 'agentDetail.configure.tools.credential.authOne'
              : undefined,
          })
        }
      `,
      )

      // Act
      const result = checkTranslationGraph(webRoot, modules)

      // Assert
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        agentV2: ['agentDetail.configure.tools.unused'],
      })
    })

    it('should collect keys from i18next instance t calls', () => {
      // Arrange
      writeJson('i18n/locales/en-US/app.json', {
        'gotoAnything.actions.createChatflow': 'Chatflow',
        'gotoAnything.actions.createChatflowDesc': 'Create a chatflow',
        'gotoAnything.actions.unused': 'Unused',
      })
      writeSource(
        'src/i18next-instance.tsx',
        `
        import { getI18n } from 'react-i18next'

        const i18n = getI18n()

        export function InstanceExample() {
          const tr = (key: 'gotoAnything.actions.createChatflowDesc') => i18n.t(key, { ns: 'app' })
          i18n.t('gotoAnything.actions.createChatflow', { ns: 'app' })
          return tr('gotoAnything.actions.createChatflowDesc')
        }
      `,
      )

      // Act
      const result = checkTranslationGraph(webRoot, modules)

      // Assert
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        app: ['gotoAnything.actions.unused'],
      })
    })

    it('should collect keys from imported and parameterized t functions', () => {
      // Arrange
      writeJson('i18n/locales/en-US/app.json', {
        noAccessPermission: 'No access',
        'typeSelector.chatbot': 'Chatbot',
        'unused.app': 'Unused app',
      })
      writeJson('i18n/locales/en-US/app-api.json', {
        pause: 'Pause',
        'unused.api': 'Unused API',
      })
      writeJson('i18n/locales/en-US/tools.json', {
        'mcp.server.publishTip': 'Publish first',
        'unused.tools': 'Unused tools',
      })
      writeSource(
        'src/parameterized.tsx',
        `
        import type { TFunction } from 'i18next'
        import { t as globalT } from 'i18next'
        import { useTranslation } from 'react-i18next'

        function appTypeLabel(t: ReturnType<typeof useTranslation>['t']) {
          return t('typeSelector.chatbot', { ns: 'app' })
        }

        function disabledTooltip(t: TFunction) {
          return t('noAccessPermission', { ns: 'app' })
        }

        function serverTooltip({ t }: { t: TFunction }) {
          return t('mcp.server.publishTip', { ns: 'tools' })
        }

        globalT('pause', { ns: 'appApi' })
      `,
      )

      // Act
      const result = checkTranslationGraph(webRoot, modules)

      // Assert
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        app: ['unused.app'],
        appApi: ['unused.api'],
        tools: ['unused.tools'],
      })
    })
  })
})
