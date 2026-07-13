import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { analyzeUnusedTranslations, removeUnusedTranslations } from '../i18n-prune/core'

let webRoot: string

function writeJson(relativePath: string, value: Record<string, string>) {
  mkdirSync(path.dirname(path.join(webRoot, relativePath)), { recursive: true })
  writeFileSync(path.join(webRoot, relativePath), `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function writeSource(relativePath: string, content: string) {
  mkdirSync(path.dirname(path.join(webRoot, relativePath)), { recursive: true })
  writeFileSync(path.join(webRoot, relativePath), content, 'utf8')
}

function sortedUnusedKeysByNamespace(
  result: Awaited<ReturnType<typeof analyzeUnusedTranslations>>,
) {
  return Object.fromEntries(
    Object.entries(result.unusedKeysByNamespace).map(([namespace, keys]) => [
      namespace,
      [...keys].sort(),
    ]),
  )
}

describe('prune-unused-i18n', () => {
  beforeEach(() => {
    webRoot = mkdtempSync(path.join(tmpdir(), 'dify-i18n-prune-'))
    writeSource('placeholder.ts', '')
  })

  afterEach(() => {
    rmSync(webRoot, { recursive: true, force: true })
  })

  describe('Usage Analysis', () => {
    it('should keep flat keys selected by t and Trans', async () => {
      // Arrange
      writeJson('i18n/en-US/app.json', {
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
      const result = await analyzeUnusedTranslations({ webRoot })

      // Assert
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        app: ['account.changeEmail.unused'],
      })
    })

    it('should use the default namespace for unresolved selectors', async () => {
      // Arrange
      writeJson('i18n/en-US/app.json', {
        'dynamic.app': 'Dynamic app key',
      })
      writeJson('i18n/en-US/common.json', {
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
      const result = await analyzeUnusedTranslations({ webRoot })

      // Assert
      expect(result.protectedNamespaces).toEqual(['app'])
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        common: ['unused.common'],
      })
    })

    it('should resolve selectors stored in variables', async () => {
      // Arrange
      writeJson('i18n/en-US/app.json', {
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
      const result = await analyzeUnusedTranslations({ webRoot })

      // Assert
      expect(result.protectedNamespaces).toEqual([])
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        app: ['unused'],
      })
    })

    it('should resolve finite selector maps with computed keys and optional entries', async () => {
      // Arrange
      writeJson('i18n/en-US/app.json', {
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
      const result = await analyzeUnusedTranslations({ webRoot })

      // Assert
      expect(result.protectedNamespaces).toEqual([])
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        app: ['unused'],
      })
    })

    it('should protect a selector map namespace when any candidate is unresolved', async () => {
      // Arrange
      writeJson('i18n/en-US/app.json', {
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
      const result = await analyzeUnusedTranslations({ webRoot })

      // Assert
      expect(result.protectedNamespaces).toEqual(['app'])
      expect(sortedUnusedKeysByNamespace(result)).toEqual({})
    })

    it('should protect known selector properties that dynamic entries can override', async () => {
      // Arrange
      writeJson('i18n/en-US/app.json', {
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
      const result = await analyzeUnusedTranslations({ webRoot })

      // Assert
      expect(result.protectedNamespaces).toEqual(['app'])
      expect(sortedUnusedKeysByNamespace(result)).toEqual({})
    })

    it('should resolve statically computed selector map properties', async () => {
      // Arrange
      writeJson('i18n/en-US/app.json', {
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
      const result = await analyzeUnusedTranslations({ webRoot })

      // Assert
      expect(result.protectedNamespaces).toEqual([])
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        app: ['unused'],
      })
    })

    it('should ignore dotted literals passed to unrelated generic functions', async () => {
      // Arrange
      writeJson('i18n/en-US/app.json', {
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
      const result = await analyzeUnusedTranslations({ webRoot })

      // Assert
      expect(result.unresolvedUsages).toEqual([])
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        app: ['unused'],
      })
    })

    it('should analyze translation adapter consumers without protecting their namespace', async () => {
      // Arrange
      writeJson('i18n/en-US/app.json', {
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
      const result = await analyzeUnusedTranslations({ webRoot })

      // Assert
      expect(result.protectedNamespaces).toEqual([])
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        app: ['unused'],
      })
    })

    it('should infer the namespace of a typed destructured translation parameter', async () => {
      // Arrange
      writeJson('i18n/en-US/app.json', {
        'unused.app': 'Unused app key',
      })
      writeJson('i18n/en-US/deployments.json', {
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
      const result = await analyzeUnusedTranslations({ webRoot })

      // Assert
      expect(result.protectedNamespaces).toEqual([])
      expect(result.unresolvedUsages).toEqual([])
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        app: ['unused.app'],
        deployments: ['unused'],
      })
    })

    it('should prefer checker namespaces for a translation parameter named t', async () => {
      // Arrange
      writeJson('i18n/en-US/agent-v-2.json', {
        'agentDetail.used': 'Used agent key',
        'agentDetail.unused': 'Unused agent key',
      })
      writeJson('i18n/en-US/app.json', {
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
      const result = await analyzeUnusedTranslations({ webRoot })

      // Assert
      expect(result.protectedNamespaces).toEqual([])
      expect(result.unresolvedUsages).toEqual([])
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        agentV2: ['agentDetail.unused'],
        app: ['unused.app'],
      })
    })

    it('should infer branded TFunction namespaces for direct and destructured parameters', async () => {
      // Arrange
      writeJson('i18n/en-US/agent-v-2.json', {
        'agentDetail.direct': 'Direct use',
        'agentDetail.destructured': 'Destructured use',
        'agentDetail.unused': 'Unused agent key',
      })
      writeJson('i18n/en-US/app.json', {
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
      const result = await analyzeUnusedTranslations({ webRoot })

      // Assert
      expect(result.protectedNamespaces).toEqual([])
      expect(result.unresolvedUsages).toEqual([])
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        agentV2: ['agentDetail.unused'],
        app: ['unused.app'],
      })
    })

    it('should ignore typed selector forwarding inside an adapter block body', async () => {
      // Arrange
      writeJson('i18n/en-US/app.json', {
        unused: 'Unused',
        used: 'Used',
      })
      writeJson('i18n/en-US/common.json', {
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
      const result = await analyzeUnusedTranslations({ webRoot })

      // Assert
      expect(result.protectedNamespaces).toEqual([])
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        app: ['unused'],
        common: ['unused.common'],
      })
    })

    it('should ignore a named adapter forwarding its typed selector parameter', async () => {
      // Arrange
      writeJson('i18n/en-US/workflow.json', {
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
      const result = await analyzeUnusedTranslations({ webRoot })

      // Assert
      expect(result.protectedNamespaces).toEqual([])
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        workflow: ['unused'],
      })
    })

    it('should resolve a selected field from nested selector map entries', async () => {
      // Arrange
      writeJson('i18n/en-US/plugin.json', {
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
      const result = await analyzeUnusedTranslations({ webRoot })

      // Assert
      expect(result.protectedNamespaces).toEqual([])
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        plugin: ['unused'],
      })
    })

    it('should conservatively protect untyped JavaScript translation adapters', async () => {
      // Arrange
      writeJson('i18n/en-US/app.json', {
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
      const result = await analyzeUnusedTranslations({ webRoot })

      // Assert
      expect(result.protectedNamespaces).toEqual(['app'])
      expect(sortedUnusedKeysByNamespace(result)).toEqual({})
    })

    it('should protect the selected namespace for an open string-key adapter', async () => {
      // Arrange
      writeJson('i18n/en-US/app.json', {
        'unused.app': 'Unused app',
      })
      writeJson('i18n/en-US/permission-keys.json', {
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
      const result = await analyzeUnusedTranslations({ webRoot })

      // Assert
      expect(result.protectedNamespaces).toEqual(['permissionKeys'])
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        app: ['unused.app'],
      })
    })

    it('should keep keys matching a dynamic selector pattern', async () => {
      // Arrange
      writeJson('i18n/en-US/plugin.json', {
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
      const result = await analyzeUnusedTranslations({ webRoot })

      // Assert
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        plugin: ['unrelated'],
      })
      expect(result.dynamicKeyPatterns).toEqual([
        expect.objectContaining({ namespace: 'plugin', prefix: 'voice.language.' }),
      ])
    })

    it('should keep selector keys from a typed union', async () => {
      // Arrange
      writeJson('i18n/en-US/common.json', {
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
      const result = await analyzeUnusedTranslations({ webRoot })

      // Assert
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        common: ['status.unused'],
      })
    })

    it('should keep selector keys from secondary namespaces', async () => {
      // Arrange
      writeJson('i18n/en-US/app.json', {
        'unused.app': 'Unused app',
      })
      writeJson('i18n/en-US/common.json', {
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
      const result = await analyzeUnusedTranslations({ webRoot })

      // Assert
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        app: ['unused.app'],
        common: ['unused.common'],
      })
    })

    it('should keep property and element access selectors from secondary namespaces', async () => {
      // Arrange
      writeJson('i18n/en-US/app.json', {
        'unused.app': 'Unused app',
      })
      writeJson('i18n/en-US/common.json', {
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
      const result = await analyzeUnusedTranslations({ webRoot })

      // Assert
      expect(result.protectedNamespaces).toEqual([])
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        app: ['unused.app'],
        common: ['unused'],
      })
    })

    it('should only protect the selected namespace for an unresolved selector', async () => {
      // Arrange
      writeJson('i18n/en-US/app.json', {
        'unused.app': 'Unused app',
      })
      writeJson('i18n/en-US/common.json', {
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
      const result = await analyzeUnusedTranslations({ webRoot })

      // Assert
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        app: ['unused.app'],
      })
      expect(result.protectedNamespaces).toEqual(['common'])
    })

    it('should keep literal keys, aliased t functions, ns options, namespace separators, and Trans keys', async () => {
      // Arrange
      writeJson('i18n/en-US/app.json', {
        'literal.title': 'Title',
        withDefault: 'With default',
        'trans.shared': 'Shared app',
        'unused.app': 'Unused app',
      })
      writeJson('i18n/en-US/common.json', {
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
      const result = await analyzeUnusedTranslations({ webRoot })

      // Assert
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        app: ['unused.app'],
        common: ['trans.shared', 'unused.common'],
      })
    })

    it('should expand resolvable dynamic keys and keep matching prefixes for unresolved dynamic keys', async () => {
      // Arrange
      writeJson('i18n/en-US/plugin.json', {
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
      const result = await analyzeUnusedTranslations({ webRoot })

      // Assert
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        plugin: ['notice.reason.legacy', 'unrelated'],
      })
      expect(result.dynamicKeyPatterns).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ namespace: 'plugin', prefix: 'voice.language.' }),
        ]),
      )
    })

    it('should protect an entire namespace when a dynamic key has no static prefix', async () => {
      // Arrange
      writeJson('i18n/en-US/app.json', {
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
      const result = await analyzeUnusedTranslations({ webRoot })

      // Assert
      expect(sortedUnusedKeysByNamespace(result)).toEqual({})
      expect(result.protectedNamespaces).toEqual(['app'])
    })

    it('should keep typed key prefixes without protecting the whole namespace', async () => {
      // Arrange
      writeJson('i18n/en-US/app-debug.json', {
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
      const result = await analyzeUnusedTranslations({ webRoot })

      // Assert
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        appDebug: ['outside.unused'],
      })
      expect(result.protectedNamespaces).toEqual([])
      expect(result.dynamicKeyPatterns).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ namespace: 'appDebug', prefix: 'duplicateError.' }),
        ]),
      )
    })

    it('should expand object map values when indexed with a dynamic key', async () => {
      // Arrange
      writeJson('i18n/en-US/common.json', {
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
      const result = await analyzeUnusedTranslations({ webRoot })

      // Assert
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        common: ['status.unused'],
      })
    })

    it('should treat simple i18n key identity helpers as their literal argument', async () => {
      // Arrange
      writeJson('i18n/en-US/common.json', {
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
          return t(workspaceSwitchI18nKey('mainNav.workspace.searchPlaceholder'), { ns: 'common' })
        }
      `,
      )

      // Act
      const result = await analyzeUnusedTranslations({ webRoot })

      // Assert
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        common: ['mainNav.workspace.unused'],
      })
    })

    it('should keep i18next plural variants when the base key is referenced', async () => {
      // Arrange
      writeJson('i18n/en-US/deployments.json', {
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
      const result = await analyzeUnusedTranslations({ webRoot })

      // Assert
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        deployments: ['overview.unused_one', 'overview.unused_other'],
      })
    })

    it('should infer plural namespaces from typed TFunction parameters', async () => {
      // Arrange
      writeJson('i18n/en-US/deployments.json', {
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
      const result = await analyzeUnusedTranslations({ webRoot })

      // Assert
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        deployments: ['overview.chip.unused_one', 'overview.chip.unused_other'],
      })
    })

    it('should keep literals assigned to typed i18n key fields', async () => {
      // Arrange
      writeJson('i18n/en-US/agent-v-2.json', {
        'agentDetail.configure.tools.credential.authOne': 'Auth 1',
        'agentDetail.configure.tools.unused': 'Unused',
      })
      writeSource(
        'src/typed-key-field.ts',
        `
        type I18nKeysWithPrefix<Namespace extends string, Prefix extends string> =
          'agentDetail.configure.tools.credential.authOne' | 'agentDetail.configure.tools.unused'

        type Tool = {
          credentialKey?: I18nKeysWithPrefix<'agentV2', 'agentDetail.configure.tools.'>
        }

        export const tool: Tool = {
          credentialKey: 'agentDetail.configure.tools.credential.authOne',
        }
      `,
      )

      // Act
      const result = await analyzeUnusedTranslations({ webRoot })

      // Assert
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        agentV2: ['agentDetail.configure.tools.unused'],
      })
    })

    it('should collect keys from i18next instance t calls', async () => {
      // Arrange
      writeJson('i18n/en-US/app.json', {
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
      const result = await analyzeUnusedTranslations({ webRoot })

      // Assert
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        app: ['gotoAnything.actions.unused'],
      })
    })

    it('should collect keys from imported and parameterized t functions', async () => {
      // Arrange
      writeJson('i18n/en-US/app.json', {
        noAccessPermission: 'No access',
        'typeSelector.chatbot': 'Chatbot',
        'unused.app': 'Unused app',
      })
      writeJson('i18n/en-US/app-api.json', {
        pause: 'Pause',
        'unused.api': 'Unused API',
      })
      writeJson('i18n/en-US/tools.json', {
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
      const result = await analyzeUnusedTranslations({ webRoot })

      // Assert
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        app: ['unused.app'],
        appApi: ['unused.api'],
        tools: ['unused.tools'],
      })
    })
  })

  describe('Removal', () => {
    it('should remove unused keys from each locale', async () => {
      // Arrange
      writeJson('i18n/en-US/app.json', {
        kept: 'Kept',
        unused: 'Unused',
      })
      writeJson('i18n/zh-Hans/app.json', {
        kept: '保留',
        unused: '未使用',
      })
      writeSource(
        'src/example.tsx',
        `
        import { useTranslation } from 'react-i18next'

        export function Example() {
          const { t } = useTranslation('app')
          return t('kept')
        }
      `,
      )
      const result = await analyzeUnusedTranslations({ webRoot })

      // Act
      const removal = await removeUnusedTranslations({ webRoot, analysis: result })

      // Assert
      expect(removal.removedKeys).toEqual([
        { locale: 'en-US', namespace: 'app', key: 'unused' },
        { locale: 'zh-Hans', namespace: 'app', key: 'unused' },
      ])
    })
  })
})
