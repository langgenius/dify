import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { transformSource } from '../migrate-i18n-selectors'

describe('migrate-i18n-selectors', () => {
  describe('Source Transformation', () => {
    it('should migrate flat t and Trans keys without reformatting surrounding code', () => {
      // Arrange
      const source = `import { Trans, useTranslation } from 'react-i18next'

export function Example() {
  const { t } = useTranslation('app')
  return <Trans i18nKey="account.changeEmail.description" ns="app">{t('account.changeEmail.title')}</Trans>
}
`

      // Act
      const result = transformSource(source, 'example.tsx')

      // Assert
      expect(result.output).toBe(`import { Trans, useTranslation } from 'react-i18next'

export function Example() {
  const { t } = useTranslation('app')
  return <Trans i18nKey={$ => $["account.changeEmail.description"]} ns="app">{t($ => $['account.changeEmail.title'])}</Trans>
}
`)
      expect(result.changes).toBe(2)
    })

    it('should migrate global, instance, dynamic, and fallback translation calls', () => {
      // Arrange
      const source = `import { t as globalT } from 'i18next'
import { useTranslation } from '#i18n'

const { t } = useTranslation('app')
globalT('global.key', { ns: 'app' })
i18n.t('instance.key', { ns: 'app' })
t(\`dynamic.\${kind}\`)
t('withFallback', 'Fallback')
`

      // Act
      const result = transformSource(source, 'example.ts')

      // Assert
      expect(result.output).toBe(`import { t as globalT } from 'i18next'
import { useTranslation } from '#i18n'

const { t } = useTranslation('app')
globalT($ => $['global.key'], { ns: 'app' })
i18n.t($ => $['instance.key'], { ns: 'app' })
t($ => $[\`dynamic.\${kind}\`])
t($ => $['withFallback'], { defaultValue: 'Fallback' })
`)
      expect(result.changes).toBe(5)
    })

    it('should leave an unrelated t binding unchanged in another lexical scope', () => {
      // Arrange
      const source = `import { useTranslation } from 'react-i18next'

function renderUnrelated() {
  const t = (key: string, fallback: string) => \`\${key}:\${fallback}\`
  return t('ordinary.key', 'Ordinary fallback')
}

export function Example() {
  const { t } = useTranslation('app')
  return t('account.changeEmail.title', 'Change email')
}
`

      // Act
      const result = transformSource(source, 'example.tsx')

      // Assert
      expect(result.output).toBe(`import { useTranslation } from 'react-i18next'

function renderUnrelated() {
  const t = (key: string, fallback: string) => \`\${key}:\${fallback}\`
  return t('ordinary.key', 'Ordinary fallback')
}

export function Example() {
  const { t } = useTranslation('app')
  return t($ => $['account.changeEmail.title'], { defaultValue: 'Change email' })
}
`)
      expect(result.changes).toBe(2)
    })

    it('should migrate legacy translation callback aliases and explicitly untyped callbacks', () => {
      // Arrange
      const source = `type Translate = (key: string, options: { ns: string }) => string

export function translateAlias(t: Translate) {
  return t('alias.key', { ns: 'app' })
}

export function translateLegacy(t: any) {
  return t('legacy.key', { ns: 'app' })
}
`

      // Act
      const result = transformSource(source, 'example.ts')

      // Assert
      expect(result.output).toBe(`type Translate = (key: string, options: { ns: string }) => string

export function translateAlias(t: Translate) {
  return t($ => $['alias.key'], { ns: 'app' })
}

export function translateLegacy(t: any) {
  return t($ => $['legacy.key'], { ns: 'app' })
}
`)
      expect(result.changes).toBe(2)
    })

    it('should follow aliased translation factory bindings without trusting shadowed names', () => {
      // Arrange
      const source = `import { useTranslation as useI18n } from 'react-i18next'
import { getTranslation as loadTranslation } from '@/i18n-config/server'

function renderUnrelated(useI18n: () => { t: (key: string) => string }) {
  const { t } = useI18n()
  return t('ordinary.key')
}

export async function Example() {
  const { t: clientT } = useI18n('app')
  const { t: serverT } = await loadTranslation('en-US', 'app')
  return [clientT('client.key'), serverT('server.key')]
}
`

      // Act
      const result = transformSource(source, 'example.tsx')

      // Assert
      expect(result.output).toBe(`import { useTranslation as useI18n } from 'react-i18next'
import { getTranslation as loadTranslation } from '@/i18n-config/server'

function renderUnrelated(useI18n: () => { t: (key: string) => string }) {
  const { t } = useI18n()
  return t('ordinary.key')
}

export async function Example() {
  const { t: clientT } = useI18n('app')
  const { t: serverT } = await loadTranslation('en-US', 'app')
  return [clientT($ => $['client.key']), serverT($ => $['server.key'])]
}
`)
      expect(result.changes).toBe(2)
    })

    it('should not rewrite fallback arguments for a shadowed imported t binding', () => {
      // Arrange
      const source = `import { t } from 'i18next'

function renderUnrelated(t: (selector: ($: Record<string, string>) => string, fallback: string) => string) {
  return t($ => $['ordinary.key'], 'Ordinary fallback')
}

export const translated = t($ => $['global.key'], 'Global fallback')
`

      // Act
      const result = transformSource(source, 'example.ts')

      // Assert
      expect(result.output).toBe(`import { t } from 'i18next'

function renderUnrelated(t: (selector: ($: Record<string, string>) => string, fallback: string) => string) {
  return t($ => $['ordinary.key'], 'Ordinary fallback')
}

export const translated = t($ => $['global.key'], { defaultValue: 'Global fallback' })
`)
      expect(result.changes).toBe(1)
    })

    it('should leave a shadowed Trans component key unchanged', () => {
      // Arrange
      const source = `import { Trans } from 'react-i18next'

function Local({ Trans }: { Trans: (props: { i18nKey: string }) => null }) {
  return <Trans i18nKey="ordinary.key" />
}

export const translated = <Trans i18nKey="global.key" />
`

      // Act
      const result = transformSource(source, 'example.tsx')

      // Assert
      expect(result.output).toBe(`import { Trans } from 'react-i18next'

function Local({ Trans }: { Trans: (props: { i18nKey: string }) => null }) {
  return <Trans i18nKey="ordinary.key" />
}

export const translated = <Trans i18nKey={$ => $["global.key"]} />
`)
      expect(result.changes).toBe(1)
    })

    it('should be idempotent after selectors are migrated', () => {
      // Arrange
      const source = `import { useTranslation } from 'react-i18next'
const { t } = useTranslation('app')
t($ => $['account.changeEmail.title'])
`

      // Act
      const result = transformSource(source, 'example.ts')

      // Assert
      expect(result).toEqual({ changes: 0, output: source })
    })

    it('should preserve selector-compatible casts, parameters, identifiers, and map entries', () => {
      // Arrange
      const source = `import type { SelectorKey, SelectorParam } from 'i18next'
import { useTranslation } from 'react-i18next'

const selectorMap: Record<'description' | 'title', SelectorParam<'app'>> = {
  description: $ => $['account.changeEmail.description'],
  title: $ => $['account.changeEmail.title'],
}
const titleSelector: SelectorParam<'app'> = $ => $['account.changeEmail.title']

export function translate(selector: SelectorParam<'app'>, key: string, kind: keyof typeof selectorMap) {
  const { t } = useTranslation('app')
  return [
    t(key as SelectorKey),
    t(selector),
    t(titleSelector),
    t(selectorMap[kind]),
  ]
}
`

      // Act
      const result = transformSource(source, 'example.ts')

      // Assert
      expect(result).toEqual({ changes: 0, output: source })
    })

    it('should adapt local react-i18next translation mocks', () => {
      // Arrange
      const source = `import { vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
}))

const businessProps = {
  t: ((key: string) => key) as never,
}
`

      // Act
      const result = transformSource(source, 'example.spec.ts')

      // Assert
      expect(result.output).toBe(`import { vi } from 'vitest'

vi.mock('react-i18next', async () => {
  const { withSelectorKey, withSelectorKeyProps } = await import('@/test/i18n-mock')
  return ({
    useTranslation: () => ({
      t: withSelectorKey((key: string) => key),
    }),
    Trans: withSelectorKeyProps(({ i18nKey }: { i18nKey: string }) => i18nKey),
  })
})

const businessProps = {
  t: ((key: string) => key) as never,
}
`)
      expect(result.changes).toBe(4)
      expect(transformSource(result.output, 'example.spec.ts')).toEqual({
        changes: 0,
        output: result.output,
      })
    })

    it('should adapt selector mocks from the local i18n facade', () => {
      // Arrange
      const source = `import { vi } from 'vitest'

vi.mock('#i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))
`

      // Act
      const result = transformSource(source, 'example.spec.ts')

      // Assert
      expect(result.output).toContain(`vi.mock('#i18n', async () => {`)
      expect(result.output).toContain(`const { withSelectorKey } = await import('@/test/i18n-mock')`)
      expect(result.output).toContain('t: withSelectorKey((key: string) => key)')
      expect(transformSource(result.output, 'example.spec.ts')).toEqual({
        changes: 0,
        output: result.output,
      })
    })

    it('should defer mock callbacks declared outside a hoisted factory', () => {
      // Arrange
      const source = `import { vi } from 'vitest'

const mockTranslation = (key: string) => key

vi.mock('#i18n', () => ({
  useTranslation: () => ({
    t: mockTranslation,
  }),
}))
`

      // Act
      const result = transformSource(source, 'example.spec.ts')

      // Assert
      expect(result.output).toContain('t: withSelectorKey((...args: Parameters<typeof mockTranslation>) => mockTranslation(...args))')
      expect(transformSource(result.output, 'example.spec.ts')).toEqual({
        changes: 0,
        output: result.output,
      })
    })

    it('should preserve selector-aware i18next mock adapters', () => {
      // Arrange
      const source = `import type { Namespace, SelectorParam } from 'i18next'
import { vi } from 'vitest'

vi.mock('i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('i18next')>()
  return {
    ...actual,
    t: <Ns extends Namespace>(selector: SelectorParam<Ns>) => actual.keyFromSelector(selector),
  }
})
`

      // Act
      const result = transformSource(source, 'example.spec.ts')

      // Assert
      expect(result).toEqual({ changes: 0, output: source })
    })

    it('should transform a multiline JSX Trans mock without overlapping edits', () => {
      // Arrange
      const source = `import type { ReactNode } from 'react'
import { vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translated = key

      return translated
    },
  }),
  Trans: ({
    i18nKey,
    components,
  }: {
    i18nKey: string
    components?: Record<string, ReactNode>
  }) => (
    <div>
      <div>{i18nKey}</div>
      {components?.CtrlKey}
      {components?.Key}
    </div>
  ),
}))
`

      // Act
      const result = transformSource(source, 'example.spec.tsx')
      const diagnostics = ts.transpileModule(result.output, {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX },
        fileName: 'example.spec.tsx',
        reportDiagnostics: true,
      }).diagnostics ?? []

      // Assert
      expect(diagnostics.filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)).toEqual([])
      expect(result.output).toContain('{components?.Key}')
      expect(result.output).not.toMatch(/[ \t]+$/m)
      expect(transformSource(result.output, 'example.spec.tsx')).toEqual({
        changes: 0,
        output: result.output,
      })
    })

    it('should adapt only translation values configured through a referenced hoisted mock', () => {
      // Arrange
      const source = `import { vi } from 'vitest'

const mockUseTranslation = vi.hoisted(() => vi.fn())
const reactI18nextMock = {
  useTranslation: () => mockUseTranslation(),
}

vi.mock('react-i18next', () => reactI18nextMock)

mockUseTranslation.mockReturnValue({
  t: (key: string) => key,
})

const businessProps = {
  t: ((key: string) => key) as never,
}
`

      // Act
      const result = transformSource(source, 'example.spec.ts')

      // Assert
      expect(result.output).toBe(`import { vi } from 'vitest'
import { withSelectorKey } from '@/test/i18n-mock'

const mockUseTranslation = vi.hoisted(() => vi.fn())
const reactI18nextMock = {
  useTranslation: () => mockUseTranslation(),
}

vi.mock('react-i18next', () => reactI18nextMock)

mockUseTranslation.mockReturnValue({
  t: withSelectorKey((key: string) => key),
})

const businessProps = {
  t: ((key: string) => key) as never,
}
`)
      expect(result.changes).toBe(2)
      expect(transformSource(result.output, 'example.spec.ts')).toEqual({
        changes: 0,
        output: result.output,
      })
    })
  })
})
