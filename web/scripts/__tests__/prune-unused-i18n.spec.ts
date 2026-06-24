import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { analyzeUnusedTranslations, removeUnusedTranslations } from '../prune-unused-i18n'

let webRoot: string

function writeJson(relativePath: string, value: Record<string, string>) {
  mkdirSync(path.dirname(path.join(webRoot, relativePath)), { recursive: true })
  writeFileSync(
    path.join(webRoot, relativePath),
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  )
}

function writeSource(relativePath: string, content: string) {
  mkdirSync(path.dirname(path.join(webRoot, relativePath)), { recursive: true })
  writeFileSync(path.join(webRoot, relativePath), content, 'utf8')
}

function sortedUnusedKeysByNamespace(result: Awaited<ReturnType<typeof analyzeUnusedTranslations>>) {
  return Object.fromEntries(
    Object.entries(result.unusedKeysByNamespace)
      .map(([namespace, keys]) => [namespace, [...keys].sort()]),
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
    it('should keep literal keys, aliased t functions, ns options, namespace separators, and Trans keys', async () => {
      // Arrange
      writeJson('i18n/en-US/app.json', {
        'literal.title': 'Title',
        'withDefault': 'With default',
        'trans.shared': 'Shared app',
        'unused.app': 'Unused app',
      })
      writeJson('i18n/en-US/common.json', {
        'operation.close': 'Close',
        'trans.shared': 'Shared common',
        'unused.common': 'Unused common',
      })
      writeSource('src/example.tsx', `
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
      `)

      // Act
      const result = await analyzeUnusedTranslations({ webRoot })

      // Assert
      expect(sortedUnusedKeysByNamespace(result)).toEqual({
        app: ['unused.app'],
        common: ['unused.common'],
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
        'unrelated': 'Unrelated',
      })
      writeSource('src/dynamic.tsx', `
        import { useTranslation } from 'react-i18next'

        const i18nPrefix = 'notice'
        const deprecatedReasonKey = 'bad'

        export function DynamicExample(language: string) {
          const { t } = useTranslation('plugin')
          t(\`\${i18nPrefix}.fullMessage\`)
          t(\`\${i18nPrefix}.reason.\${deprecatedReasonKey}\`)
          t(\`voice.language.\${language}\`, 'Fallback', { ns: 'plugin' })
        }
      `)

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
      writeSource('src/unresolved.tsx', `
        import { useTranslation } from 'react-i18next'

        export function UnresolvedExample(keyFromServer: string) {
          const { t } = useTranslation('app')
          return t(keyFromServer)
        }
      `)

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
      writeSource('src/typed-prefix.tsx', `
        import type { I18nKeysByPrefix } from '@/types/i18n'
        import { useTranslation } from 'react-i18next'

        export function TypedPrefixExample(errorKey: string) {
          const { t } = useTranslation()
          return t(errorKey as I18nKeysByPrefix<'appDebug', 'duplicateError.'>, { ns: 'appDebug' })
        }
      `)

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
      writeSource('src/object-map.tsx', `
        import { useTranslation } from 'react-i18next'

        const statusI18nKey = {
          ready: 'status.ready',
          failed: 'status.failed',
        } as const

        export function ObjectMapExample(status: keyof typeof statusI18nKey) {
          const { t } = useTranslation('common')
          return t(statusI18nKey[status])
        }
      `)

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
      writeSource('src/identity-helper.tsx', `
        import { useTranslation } from 'react-i18next'

        const workspaceSwitchI18nKey = (key: string) => key as 'mainNav.workspace.settings'

        export function IdentityHelperExample() {
          const { t } = useTranslation()
          return t(workspaceSwitchI18nKey('mainNav.workspace.searchPlaceholder'), { ns: 'common' })
        }
      `)

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
      writeSource('src/plural.tsx', `
        import { useTranslation } from 'react-i18next'

        export function PluralExample(count: number) {
          const { t } = useTranslation('deployments')
          return t('overview.environments', { count })
        }
      `)

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
      writeSource('src/typed-t-function.ts', `
        import type { TFunction } from 'i18next'

        export function renderStatus(t: TFunction<'deployments'>) {
          return t('overview.chip.behind', { count: 2 })
        }
      `)

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
      writeSource('src/typed-key-field.ts', `
        type I18nKeysWithPrefix<Namespace extends string, Prefix extends string> =
          'agentDetail.configure.tools.credential.authOne' | 'agentDetail.configure.tools.unused'

        type Tool = {
          credentialKey?: I18nKeysWithPrefix<'agentV2', 'agentDetail.configure.tools.'>
        }

        export const tool: Tool = {
          credentialKey: 'agentDetail.configure.tools.credential.authOne',
        }
      `)

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
      writeSource('src/i18next-instance.tsx', `
        import { getI18n } from 'react-i18next'

        const i18n = getI18n()

        export function InstanceExample() {
          const tr = (key: 'gotoAnything.actions.createChatflowDesc') => i18n.t(key, { ns: 'app' })
          i18n.t('gotoAnything.actions.createChatflow', { ns: 'app' })
          return tr('gotoAnything.actions.createChatflowDesc')
        }
      `)

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
        'noAccessPermission': 'No access',
        'typeSelector.chatbot': 'Chatbot',
        'unused.app': 'Unused app',
      })
      writeJson('i18n/en-US/app-api.json', {
        'pause': 'Pause',
        'unused.api': 'Unused API',
      })
      writeJson('i18n/en-US/tools.json', {
        'mcp.server.publishTip': 'Publish first',
        'unused.tools': 'Unused tools',
      })
      writeSource('src/parameterized.tsx', `
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
      `)

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
      writeSource('src/example.tsx', `
        import { useTranslation } from 'react-i18next'

        export function Example() {
          const { t } = useTranslation('app')
          return t('kept')
        }
      `)
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
