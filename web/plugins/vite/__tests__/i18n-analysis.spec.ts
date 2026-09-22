import type { AnalysisReport } from '../i18n-analysis'
// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build, createBuilder, createLogger, createServer } from 'vite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { i18nAnalysisPlugin as createI18nAnalysisPlugin } from '../i18n-analysis'

const i18nAnalysisPlugin = (options: Parameters<typeof createI18nAnalysisPlugin>[0] = {}) =>
  createI18nAnalysisPlugin({
    ...options,
    adapters: options.adapters ?? [
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
    ],
  })

describe('i18n build check', () => {
  let root: string
  let localeFile: string

  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), 'dify-i18n-build-')))
    mkdirSync(path.join(root, 'i18n/locales/en-US'), { recursive: true })
    localeFile = path.join(root, 'i18n/locales/en-US/app.json')
    writeFileSync(
      path.join(root, 'entry.ts'),
      `
      export function translate(t: (key: string) => string) {
        return t('app:used')
      }
    `,
    )
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  const buildFixture = () =>
    build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [i18nAnalysisPlugin()],
      build: {
        write: false,
        lib: { entry: path.join(root, 'entry.ts'), formats: ['es'] },
      },
    })

  it('reports each route with inherited, lazy and environment-specific namespaces', async () => {
    const files: Record<string, string> = {
      'entry.ts': `export { page } from './app/(group)/items/[id]/page'
        export { other } from './app/other/page'
        export { layout } from './app/layout'
        export { group } from './app/(group)/layout'`,
      'app/layout.ts': `export function layout(t: (key: string) => string) { return t('common:title') }`,
      'app/(group)/layout.ts': `export function group(t: (key: string) => string) { return t('group:title') }`,
      'app/(group)/items/[id]/page.ts': `export { page } from '../../../../component'`,
      'app/other/page.ts': `export function other(t: (key: string) => string) { return t('other:title') }`,
      'component.ts': `export function page(t: (key: string) => string) { return t('app:used') }
        export const lazy = () => import('./lazy')`,
      'lazy.ts': `export function lazy(t: (key: string) => string) { return t('lazy:title') }`,
      'unimported.ts': `export function ignored(t: (key: string) => string) { return t('ignored:title') }`,
    }
    for (const [file, source] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
      writeFileSync(path.join(root, file), source)
    }
    for (const namespace of ['common', 'group', 'other', 'lazy', 'client', 'ssr'])
      writeFileSync(
        path.join(root, `i18n/locales/en-US/${namespace}.json`),
        JSON.stringify({ title: 'Title' }),
      )
    writeFileSync(localeFile, '{}')
    const logger = createLogger('silent')
    const info = vi.spyOn(logger, 'info')
    const builder = await createBuilder({
      root,
      configFile: false,
      customLogger: logger,
      plugins: [
        {
          name: 'environment-translation',
          enforce: 'pre',
          transform(code, id) {
            if (id === path.join(root, 'component.ts'))
              return code.replace('app:used', `${this.environment.name}:title`)
          },
        },
        i18nAnalysisPlugin(),
      ],
      environments: { client: {}, ssr: {} },
      build: { write: true, lib: { entry: path.join(root, 'entry.ts'), formats: ['es'] } },
    })
    await builder.buildApp()
    const reports = info.mock.calls
      .map(([message]) => message)
      .filter((message) => message.startsWith('[i18n] Route'))
    expect(reports).toHaveLength(1)
    expect(reports[0]).toBe(
      '[i18n] Routes: 2; unknown namespace records: 0; dynamic key records: 0; protected namespaces: (none).',
    )
    expect(info.mock.calls.some(([message]) => message.includes('/items/[id]'))).toBe(false)
    const artifact: unknown = JSON.parse(
      readFileSync(path.join(root, 'dist/i18n-routes.json'), 'utf8'),
    )
    expect(artifact).toMatchObject({
      version: 3,
      routes: expect.arrayContaining([
        expect.objectContaining({
          route: '/items/[id]',
          namespaces: ['client', 'common', 'group', 'lazy', 'ssr'],
          groups: {
            page: [
              expect.objectContaining({ namespace: 'client', sources: ['component.ts'] }),
              expect.objectContaining({ namespace: 'ssr', sources: ['component.ts'] }),
            ],
            shared: [
              expect.objectContaining({ namespace: 'common', sources: ['app/layout.ts'] }),
              expect.objectContaining({ namespace: 'group', sources: ['app/(group)/layout.ts'] }),
            ],
            lazy: [expect.objectContaining({ namespace: 'lazy', sources: ['lazy.ts'] })],
            slots: [],
          },
        }),
        expect.objectContaining({ route: '/other', namespaces: ['common', 'other'] }),
      ]),
    })
  })

  it('fails opted-in route builds with undeclared dynamic dependencies and their source paths', async () => {
    writeFileSync(localeFile, JSON.stringify({ used: 'Used' }))
    mkdirSync(path.join(root, 'app/signin/check-code'), { recursive: true })
    writeFileSync(
      path.join(root, 'app/signin/check-code/page.ts'),
      `export const page = () => import('../../../lazy')`,
    )
    writeFileSync(
      path.join(root, 'lazy.ts'),
      `export function label(t: (key: string) => string) { return t('app:used') }`,
    )
    writeFileSync(
      path.join(root, 'entry.ts'),
      `export { page } from './app/signin/check-code/page'`,
    )
    let enabled = true
    const run = () =>
      build({
        root,
        configFile: false,
        logLevel: 'silent',
        plugins: [
          i18nAnalysisPlugin({
            getDeclaredNamespaces: (route) =>
              enabled && route.startsWith('/signin/') ? ['common', 'login'] : undefined,
          }),
        ],
        build: { write: false, lib: { entry: path.join(root, 'entry.ts'), formats: ['es'] } },
      })
    await expect(run()).rejects.toThrow(
      /\/signin\/check-code[\s\S]*Undeclared namespace: app[\s\S]*\[lazy\] lazy.ts/,
    )
    enabled = false
    await expect(run()).resolves.toBeDefined()
  })

  it('fails builds with actionable findings without modifying translations', async () => {
    const content = JSON.stringify({ used: 'Used', unused: 'Unused' })
    writeFileSync(localeFile, content)

    await expect(buildFixture()).rejects.toThrow(
      /Found 1 potentially unused i18n keys[\s\S]*static analysis of the current build module graph[\s\S]*false positives or miss unused keys[\s\S]*Review actual usage before removing any keys[\s\S]*app:unused/,
    )
    expect(readFileSync(localeFile, 'utf8')).toBe(content)
  })

  it('allows builds after unused translations are removed', async () => {
    writeFileSync(localeFile, JSON.stringify({ used: 'Used' }))

    await expect(buildFixture()).resolves.toBeDefined()
  })

  it('does not count usage in modules outside the build graph', async () => {
    writeFileSync(localeFile, JSON.stringify({ used: 'Used', testOnly: 'Only in tests' }))
    writeFileSync(
      path.join(root, 'unimported.spec.ts'),
      `
      export function fixture(t: (key: string) => string) { return t('app:testOnly') }
    `,
    )
    writeFileSync(
      path.join(root, 'types.ts'),
      `
      export type Label = string
      export function fixture(t: (key: string) => string) { return t('app:testOnly') }
    `,
    )
    writeFileSync(
      path.join(root, 'entry.ts'),
      `
      import type { Label } from './types'
      export function translate(t: (key: string) => Label) { return t('app:used') }
    `,
    )

    await expect(buildFixture()).rejects.toThrow('app:testOnly')
  })

  it('includes dynamically imported modules in the graph', async () => {
    writeFileSync(localeFile, JSON.stringify({ used: 'Used', lazy: 'Lazy' }))
    writeFileSync(
      path.join(root, 'lazy.ts'),
      `
      export function lazy(t: (key: string) => string) { return t('app:lazy') }
    `,
    )
    writeFileSync(
      path.join(root, 'entry.ts'),
      `
      export const lazy = () => import('./lazy')
      export function translate(t: (key: string) => string) { return t('app:used') }
    `,
    )

    await expect(buildFixture()).resolves.toBeDefined()
  })

  // Six real environment builds plus graph analysis need headroom under CI contention.
  it(
    'checks the union of client, SSR and RSC graphs only after every environment builds',
    { timeout: 15_000 },
    async () => {
      writeFileSync(localeFile, JSON.stringify({ client: 'Client', ssr: 'SSR', rsc: 'RSC' }))
      for (const name of ['client', 'ssr', 'rsc']) {
        writeFileSync(
          path.join(root, `${name}.ts`),
          `
        export function translate(t: (key: string) => string) { return t('app:${name}') }
      `,
        )
      }
      const completed: string[] = []
      const builder = await createBuilder({
        root,
        configFile: false,
        logLevel: 'silent',
        plugins: [i18nAnalysisPlugin()],
        environments: Object.fromEntries(
          ['client', 'ssr', 'rsc'].map((name) => [
            name,
            {
              build: {
                write: false,
                lib: { entry: path.join(root, `${name}.ts`), formats: ['es'] },
              },
            },
          ]),
        ),
        builder: {
          async buildApp(builder) {
            for (const environment of Object.values(builder.environments)) {
              await builder.build(environment)
              completed.push(environment.name)
            }
          },
        },
      })

      await expect(builder.buildApp()).resolves.toBeUndefined()
      expect(completed).toEqual(['client', 'ssr', 'rsc'])

      // A second build must not inherit the first build's server usage.
      writeFileSync(path.join(root, 'ssr.ts'), 'export const value = 1')
      await expect(builder.buildApp()).rejects.toThrow('app:ssr')
    },
  )

  it('retains usages from environment-specific versions of the same module', async () => {
    writeFileSync(localeFile, JSON.stringify({ client: 'Client', ssr: 'SSR' }))
    const builder = await createBuilder({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [
        {
          name: 'environment-source-fixture',
          enforce: 'pre',
          transform(code, id) {
            if (id !== path.join(root, 'entry.ts')) return
            return code.replace('app:used', `app:${this.environment.name}`)
          },
        },
        i18nAnalysisPlugin(),
      ],
      environments: {
        client: {},
        ssr: {},
      },
      build: {
        write: false,
        lib: { entry: path.join(root, 'entry.ts'), formats: ['es'] },
      },
    })

    await expect(builder.buildApp()).resolves.toBeUndefined()
  })

  it.each([
    ['client', 'ssr'],
    ['ssr', 'client'],
  ])('resolves imported selectors in their own environments (%s first)', async (first, second) => {
    writeFileSync(localeFile, JSON.stringify({ client: 'Client', ssr: 'SSR' }))
    writeFileSync(
      path.join(root, 'selector.ts'),
      `
      export const selector = ($: Record<string, string>) => $.placeholder
    `,
    )
    writeFileSync(
      path.join(root, 'entry.ts'),
      `
      import { selector } from './selector'
      export function label(t: (selector: (source: Record<string, string>) => string) => string) {
        return t(selector)
      }
    `,
    )
    const builder = await createBuilder({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [
        {
          name: 'environment-selector-fixture',
          enforce: 'pre',
          transform(code, id) {
            if (id === path.join(root, 'selector.ts'))
              return code.replace('$.placeholder', `$.${this.environment.name}`)
          },
        },
        i18nAnalysisPlugin(),
      ],
      environments: { client: {}, ssr: {} },
      builder: {
        async buildApp(builder) {
          for (const name of [first, second]) await builder.build(builder.environments[name]!)
        },
      },
      build: {
        write: false,
        lib: { entry: path.join(root, 'entry.ts'), formats: ['es'] },
      },
    })

    await expect(builder.buildApp()).resolves.toBeUndefined()

    writeFileSync(localeFile, JSON.stringify({ client: 'Client', ssr: 'SSR', unused: 'Unused' }))
    await expect(builder.buildApp()).rejects.toThrow(
      /Found 1 potentially unused i18n keys[\s\S]*app:unused/,
    )
  })

  it('uses Vite aliases for imported namespace values', async () => {
    writeFileSync(localeFile, '{}')
    mkdirSync(path.join(root, 'app'), { recursive: true })
    writeFileSync(
      path.join(root, 'i18n/lib.client.ts'),
      `export function useTranslation(namespace: string) { return namespace }`,
    )
    writeFileSync(path.join(root, 'app/ns.ts'), `export const ns = 'old'`)
    writeFileSync(path.join(root, 'app/actual.ts'), `export const ns = 'actual'`)
    writeFileSync(
      path.join(root, 'app/page.ts'),
      `
      import { ns } from './ns'
      import { useTranslation } from '../i18n/lib.client'
      export const page = useTranslation(ns)
    `,
    )
    const run = (declared: string[]) =>
      build({
        root,
        configFile: false,
        logLevel: 'silent',
        resolve: { alias: [{ find: './ns', replacement: path.join(root, 'app/actual.ts') }] },
        plugins: [i18nAnalysisPlugin({ getDeclaredNamespaces: () => declared })],
        build: { write: false, lib: { entry: path.join(root, 'app/page.ts'), formats: ['es'] } },
      })
    await expect(run(['actual'])).resolves.toBeDefined()
    await expect(run(['old'])).rejects.toThrow('Undeclared namespace: actual')
  })

  it.each([
    "export {ns} from './ns'",
    "export {\n ns,\n} from './ns'",
    "export { ns, type Key } from './ns'",
    "export { value as ns } from './ns'",
  ])('preserves runtime re-export bindings: %s', async (declaration) => {
    writeFileSync(localeFile, '{}')
    mkdirSync(path.join(root, 'app'), { recursive: true })
    writeFileSync(
      path.join(root, 'i18n/lib.client.ts'),
      `export function useTranslation(namespace: string) { return namespace }`,
    )
    writeFileSync(
      path.join(root, 'app/ns.ts'),
      `export const ns = 'actual'; export const value = 'actual'; export type Key = 'used'`,
    )
    writeFileSync(path.join(root, 'app/barrel.ts'), declaration)
    writeFileSync(
      path.join(root, 'app/page.ts'),
      `
      import { ns } from './barrel'
      import { useTranslation } from '../i18n/lib.client'
      export const page = useTranslation(ns)
    `,
    )
    const reports: AnalysisReport[] = []
    await expect(
      build({
        root,
        configFile: false,
        logLevel: 'silent',
        plugins: [
          i18nAnalysisPlugin({
            onAnalysis: (report) => reports.push(report),
            getDeclaredNamespaces: () => ['old'],
          }),
        ],
        build: { write: false, lib: { entry: path.join(root, 'app/page.ts'), formats: ['es'] } },
      }),
    ).rejects.toThrow('Undeclared namespace: actual')
    expect(reports[0]!.routes[0]!.namespaces).toEqual(['actual'])
    expect(reports[0]!.evidence.some((item) => item.kind === 'unresolved-import')).toBe(false)
  })

  it('preserves query variants and resolves their imported selectors independently', async () => {
    writeFileSync(localeFile, JSON.stringify({ a: 'A', b: 'B' }))
    mkdirSync(path.join(root, 'app'), { recursive: true })
    writeFileSync(
      path.join(root, 'app/page.ts'),
      `
      import { selector as a } from './selector.ts?a'
      import { selector as b } from './selector.ts?b'
      export function page(t: (selector: (source: Record<string, string>) => string) => string) {
        return [t(a), t(b)]
      }
    `,
    )
    writeFileSync(
      path.join(root, 'app/selector.ts'),
      `
      export const selector = ($: Record<string, string>) => $.placeholder
    `,
    )
    const run = () =>
      build({
        root,
        configFile: false,
        logLevel: 'silent',
        plugins: [
          {
            name: 'query-selectors',
            enforce: 'pre',
            transform(code, id) {
              if (id.includes('/selector.ts?'))
                return code.replace('$.placeholder', id.endsWith('?a') ? '$.a' : '$.b')
            },
          },
          i18nAnalysisPlugin(),
        ],
        build: { write: false, lib: { entry: path.join(root, 'app/page.ts'), formats: ['es'] } },
      })
    await expect(run()).resolves.toBeDefined()
    writeFileSync(localeFile, JSON.stringify({ a: 'A', b: 'B', unused: 'Unused' }))
    await expect(run()).rejects.toThrow(/Found 1 potentially unused i18n keys[\s\S]*app:unused/)
  })

  it('keeps route dependencies separate for query variants of the same module', async () => {
    writeFileSync(localeFile, '{}')
    for (const namespace of ['a', 'b']) {
      mkdirSync(path.join(root, `app/${namespace}`), { recursive: true })
      writeFileSync(
        path.join(root, `i18n/locales/en-US/${namespace}.json`),
        JSON.stringify({ title: namespace }),
      )
      writeFileSync(
        path.join(root, `app/${namespace}/page.ts`),
        `export { label as page } from '../../label.ts?${namespace}'`,
      )
    }
    writeFileSync(
      path.join(root, 'entry.ts'),
      `
      export { page as a } from './app/a/page'
      export { page as b } from './app/b/page'
    `,
    )
    writeFileSync(
      path.join(root, 'label.ts'),
      `
      export function label(t: (key: string) => string) { return t('placeholder:title') }
    `,
    )
    await expect(
      build({
        root,
        configFile: false,
        logLevel: 'silent',
        plugins: [
          {
            name: 'query-labels',
            enforce: 'pre',
            transform(code, id) {
              if (id.includes('/label.ts?'))
                return code.replace('placeholder:title', id.endsWith('?a') ? 'a:title' : 'b:title')
            },
          },
          i18nAnalysisPlugin({ getDeclaredNamespaces: (route) => [route.slice(1)] }),
        ],
        build: { write: false, lib: { entry: path.join(root, 'entry.ts'), formats: ['es'] } },
      }),
    ).resolves.toBeDefined()
  })

  it('leaves erased type-only packages to TypeScript resolution', async () => {
    writeFileSync(localeFile, JSON.stringify({ used: 'Used', unused: 'Unused' }))
    mkdirSync(path.join(root, 'node_modules/labels'), { recursive: true })
    writeFileSync(
      path.join(root, 'node_modules/labels/package.json'),
      JSON.stringify({ name: 'labels', types: './index.d.ts' }),
    )
    writeFileSync(path.join(root, 'node_modules/labels/index.d.ts'), `export type Label = 'used'`)
    writeFileSync(
      path.join(root, 'entry.ts'),
      `
      import type { Label } from 'labels'
      export function label(t: (key: string) => string, key: Label) { return t(key) }
    `,
    )
    await expect(buildFixture()).rejects.toThrow(
      /Found 1 potentially unused i18n keys[\s\S]*app:unused/,
    )
  })

  it.each(["export type { Key } from './types'", "export { type Key } from './types'"])(
    'preserves erased type re-exports: %s',
    async (declaration) => {
      writeFileSync(localeFile, JSON.stringify({ used: 'Used', unused: 'Unused' }))
      writeFileSync(path.join(root, 'types.ts'), `export type Key = 'used'`)
      writeFileSync(path.join(root, 'barrel.ts'), `${declaration}; export const marker = 1`)
      writeFileSync(
        path.join(root, 'entry.ts'),
        `
        import { type Key, marker } from './barrel'
        export function label(t: (key: string) => string, key: Key) { return [marker, t(key)] }
      `,
      )
      const reports: AnalysisReport[] = []
      await expect(
        build({
          root,
          configFile: false,
          logLevel: 'silent',
          plugins: [i18nAnalysisPlugin({ onAnalysis: (report) => reports.push(report) })],
          build: { write: false, lib: { entry: path.join(root, 'entry.ts'), formats: ['es'] } },
        }),
      ).rejects.toThrow(/Found 1 potentially unused i18n keys[\s\S]*app:unused/)
      expect(
        reports[0]!.evidence.some(
          (item) => item.kind === 'unresolved-import' || item.kind === 'dynamic-key',
        ),
      ).toBe(false)
    },
  )

  it.each(['type', 'prefix'] as const)(
    'uses transformed JSON for %s key analysis',
    async (mode) => {
      writeFileSync(localeFile, JSON.stringify({ 'category.used': 'Used', unused: 'Unused' }))
      writeFileSync(path.join(root, 'labels.json'), JSON.stringify({ old: 'Old' }))
      writeFileSync(
        path.join(root, 'entry.ts'),
        mode === 'type'
          ? `
      import labels from './labels.json'
      export function label(t: (key: string) => string, key: keyof typeof labels) { return [labels, t(key)] }
    `
          : `
      import labels from './labels.json'
      export function label(t: (selector: (value: Record<string, string>) => string) => string, name: string) {
        const key = \`category.\${name}\` as keyof typeof labels
        return [labels, t($ => $[key])]
      }
    `,
      )
      const reports: AnalysisReport[] = []
      await expect(
        build({
          root,
          configFile: false,
          logLevel: 'silent',
          plugins: [
            i18nAnalysisPlugin({ onAnalysis: (report) => reports.push(report) }),
            {
              name: 'replace-json-data',
              transform(_code, id) {
                if (id.endsWith('/labels.json')) return 'export default { "category.used": "Used" }'
              },
            },
          ],
          build: { write: false, lib: { entry: path.join(root, 'entry.ts'), formats: ['es'] } },
        }),
      ).rejects.toThrow(/Found 1 potentially unused i18n keys[\s\S]*app:unused/)
      expect(
        reports[0]!.evidence.some(
          (item) => item.kind === 'unresolved-import' || item.kind === 'dynamic-key',
        ),
      ).toBe(false)
    },
  )

  it.each([
    "function load(ns: string) { return useTranslation(ns) }; export const page = load('app')",
    "function load(ns = 'app') { return useTranslation(ns) }; export const page = load(...[] as [])",
    "const ns = ['app']; export const page = useTranslation(ns)",
    "let ns = 'app'; ns = 'login'; export const page = useTranslation(ns)",
    "const ns = ['app']; const alias = ns; alias['push']('login'); export const page = useTranslation(ns)",
    "function policy() { return ['app'] }; export const page = useTranslation(policy())",
  ])('rejects runtime namespace values in strict mode: %s', async (body) => {
    writeFileSync(localeFile, '{}')
    writeFileSync(
      path.join(root, 'i18n/lib.client.ts'),
      'export function useTranslation(ns: unknown) { return ns }',
    )
    mkdirSync(path.join(root, 'app'), { recursive: true })
    writeFileSync(
      path.join(root, 'app/page.ts'),
      `import { useTranslation } from '../i18n/lib.client'; ${body}`,
    )
    const reports: AnalysisReport[] = []
    await expect(
      build({
        root,
        configFile: false,
        logLevel: 'silent',
        plugins: [
          i18nAnalysisPlugin({
            strictNamespaces: true,
            getDeclaredNamespaces: () => ['app'],
            onAnalysis: (report) => reports.push(report),
          }),
        ],
        build: { write: false, lib: { entry: path.join(root, 'app/page.ts'), formats: ['es'] } },
      }),
    ).rejects.toThrow('Cannot verify namespace usage')
    expect(reports[0]!.routes[0]!.unknownNamespaceSources).toEqual(['app/page.ts'])
  })

  it.each(['broken', 'good'] as const)(
    'limits strict unknown namespace validation to the %s route',
    async (selected) => {
      writeFileSync(localeFile, '{}')
      writeFileSync(
        path.join(root, 'i18n/lib.client.ts'),
        `export function useTranslation(ns: string) { return ns }`,
      )
      for (const route of ['broken', 'good']) {
        mkdirSync(path.join(root, `app/${route}`), { recursive: true })
        writeFileSync(
          path.join(root, `app/${route}/page.ts`),
          `
        import { useTranslation } from '../../i18n/lib.client'
        export function page(ns: string) { return useTranslation(${route === 'broken' ? 'ns' : "'app'"}) }
      `,
        )
      }
      writeFileSync(
        path.join(root, 'entry.ts'),
        `export { page as broken } from './app/broken/page'; export { page as good } from './app/good/page'`,
      )
      const reports: AnalysisReport[] = []
      const result = build({
        root,
        configFile: false,
        logLevel: 'silent',
        plugins: [
          i18nAnalysisPlugin({
            strictNamespaces: true,
            onAnalysis: (report) => reports.push(report),
            getDeclaredNamespaces: (route) => (route === `/${selected}` ? ['app'] : undefined),
          }),
        ],
        build: { write: false, lib: { entry: path.join(root, 'entry.ts'), formats: ['es'] } },
      })
      if (selected === 'broken')
        await expect(result).rejects.toThrow(/Cannot verify namespace usage: app\/broken\/page.ts/)
      else await expect(result).resolves.toBeDefined()
      expect(
        reports[0]!.routes.find((route) => route.route === '/broken')!.unknownNamespaceSources,
      ).toEqual(['app/broken/page.ts'])
      expect(
        reports[0]!.routes.find((route) => route.route === '/good')!.unknownNamespaceSources,
      ).toEqual([])
    },
  )

  it.each(['named', 'namespace'] as const)(
    'does not treat a local Vite alias as the official API through %s imports',
    async (kind) => {
      writeFileSync(localeFile, '{}')
      mkdirSync(path.join(root, 'app'), { recursive: true })
      writeFileSync(
        path.join(root, 'replacement.ts'),
        `export function useTranslation(value: string) { return value }`,
      )
      writeFileSync(
        path.join(root, 'app/page.ts'),
        kind === 'named'
          ? `import { useTranslation as load } from 'react-i18next'; export const page = load('placeholder')`
          : `import * as labels from 'react-i18next'; export const page = labels.useTranslation('placeholder')`,
      )
      const reports: AnalysisReport[] = []
      await expect(
        build({
          root,
          configFile: false,
          logLevel: 'silent',
          resolve: { alias: { 'react-i18next': path.join(root, 'replacement.ts') } },
          plugins: [
            i18nAnalysisPlugin({
              strictNamespaces: true,
              getDeclaredNamespaces: () => [],
              onAnalysis: (report) => reports.push(report),
            }),
          ],
          build: { write: false, lib: { entry: path.join(root, 'app/page.ts'), formats: ['es'] } },
        }),
      ).resolves.toBeDefined()
      expect(reports[0]!.routes[0]!.namespaces).toEqual([])
      expect(reports[0]!.routes[0]!.unknownNamespaceSources).toEqual([])
    },
  )

  it.each(['static', 'dynamic', 'undeclared'] as const)(
    'validates %s metadata adapter calls through aliased exports and re-exports',
    async (mode) => {
      writeFileSync(localeFile, '{}')
      writeFileSync(
        path.join(root, 'i18n/locales/en-US/common.json'),
        JSON.stringify({ used: 'Used' }),
      )
      mkdirSync(path.join(root, 'app'), { recursive: true })
      writeFileSync(
        path.join(root, 'i18n/server.ts'),
        `
      export function getTranslation(locale: string, ns: string) {
        return { t: (selector: (source: Record<string, string>) => string, options: { ns: string }) => selector({ used: 'Used' }) }
      }
    `,
      )
      writeFileSync(
        path.join(root, 'app/route-metadata.ts'),
        `
      import { getTranslation } from '../i18n/server'
      async function internalMetadata(namespace: string, selector: (source: Record<string, string>) => string) {
        const { t } = getTranslation('en-US', namespace)
        return { title: t(selector, { ns: namespace }) }
      }
      export { internalMetadata as getRouteMetadata }
    `,
      )
      writeFileSync(
        path.join(root, 'metadata.ts'),
        `export { getRouteMetadata as title } from './app/route-metadata'`,
      )
      writeFileSync(
        path.join(root, 'app/page.ts'),
        `
      import { title as metadata } from '../metadata'
      export function page(ns: string) { return metadata(${mode === 'dynamic' ? 'ns' : "'common'"}, $ => $.used) }
    `,
      )
      const reports: AnalysisReport[] = []
      const result = build({
        root,
        configFile: false,
        logLevel: 'silent',
        plugins: [
          i18nAnalysisPlugin({
            strictNamespaces: true,
            getDeclaredNamespaces: () => (mode === 'undeclared' ? ['app'] : ['common']),
            onAnalysis: (report) => reports.push(report),
          }),
        ],
        build: { write: false, lib: { entry: path.join(root, 'app/page.ts'), formats: ['es'] } },
      })
      if (mode === 'dynamic')
        await expect(result).rejects.toThrow('Cannot verify namespace usage: app/page.ts')
      else if (mode === 'undeclared')
        await expect(result).rejects.toThrow('Undeclared namespace: common')
      else await expect(result).resolves.toBeDefined()
      expect(reports[0]!.routes[0]!.unknownNamespaceSources).toEqual(
        mode === 'dynamic' ? ['app/page.ts'] : [],
      )
      expect(reports[0]!.routes[0]!.namespaces).toEqual(
        mode === 'dynamic' ? ['app', 'common'] : ['common'],
      )
    },
  )

  it.each(["['login', ns]", "[...ns, 'login']", "[...['login', ...ns]]"])(
    'rejects known undeclared namespaces in partially dynamic arrays: %s',
    async (argument) => {
      writeFileSync(localeFile, '{}')
      writeFileSync(
        path.join(root, 'i18n/lib.client.ts'),
        'export function useTranslation(ns: unknown) { return ns }',
      )
      mkdirSync(path.join(root, 'app'), { recursive: true })
      writeFileSync(
        path.join(root, 'app/page.ts'),
        `
        import { useTranslation } from '../i18n/lib.client'
        export function page(ns: string[]) { return useTranslation(${argument}) }
      `,
      )
      const reports: AnalysisReport[] = []
      await expect(
        build({
          root,
          configFile: false,
          logLevel: 'silent',
          plugins: [
            i18nAnalysisPlugin({
              getDeclaredNamespaces: () => ['app'],
              onAnalysis: (report) => reports.push(report),
            }),
          ],
          build: { write: false, lib: { entry: path.join(root, 'app/page.ts'), formats: ['es'] } },
        }),
      ).rejects.toThrow('Undeclared namespace: login')
      expect(reports[0]!.routes[0]!.namespaces).toEqual(['login'])
      expect(reports[0]!.routes[0]!.unknownNamespaceSources).toEqual(['app/page.ts'])
    },
  )

  it('reports runtime provider namespaces without blocking non-strict validation', async () => {
    writeFileSync(localeFile, '{}')
    writeFileSync(
      path.join(root, 'i18n/lib.client.ts'),
      'export function useTranslation(ns: unknown) { return ns }',
    )
    mkdirSync(path.join(root, 'app'), { recursive: true })
    writeFileSync(
      path.join(root, 'app/page.ts'),
      `import { useTranslation } from '../i18n/lib.client';
      function policy() { return ['app'] }; export const page = useTranslation(policy())`,
    )
    const reports: AnalysisReport[] = []
    await expect(
      build({
        root,
        configFile: false,
        logLevel: 'silent',
        plugins: [
          i18nAnalysisPlugin({
            getDeclaredNamespaces: () => ['app'],
            onAnalysis: (report) => reports.push(report),
          }),
        ],
        build: { write: false, lib: { entry: path.join(root, 'app/page.ts'), formats: ['es'] } },
      }),
    ).resolves.toBeDefined()
    expect(reports[0]!.routes[0]!.namespaces).toEqual([])
    expect(reports[0]!.routes[0]!.unknownNamespaceSources).toEqual(['app/page.ts'])
  })

  it('tracks rewritten imports and analyzes multiple output formats only once', async () => {
    writeFileSync(localeFile, JSON.stringify({ actual: 'Actual' }))
    writeFileSync(
      path.join(root, 'old.ts'),
      `export const selector = ($: Record<string, string>) => $.old`,
    )
    writeFileSync(
      path.join(root, 'actual.ts'),
      `export const selector = ($: Record<string, string>) => $.actual`,
    )
    writeFileSync(
      path.join(root, 'entry.ts'),
      `
      import { selector } from './old'
      export function label(t: (selector: (value: Record<string, string>) => string) => string) { return t(selector) }
    `,
    )
    const reports: AnalysisReport[] = []
    await expect(
      build({
        root,
        configFile: false,
        logLevel: 'silent',
        plugins: [
          i18nAnalysisPlugin({ onAnalysis: (report) => reports.push(report) }),
          {
            name: 'rewrite-import',
            transform(code, id) {
              if (id.endsWith('/entry.ts')) return code.replace('./old', './actual')
            },
          },
        ],
        build: {
          write: false,
          lib: { entry: path.join(root, 'entry.ts'), formats: ['es', 'cjs'] },
        },
      }),
    ).resolves.toBeDefined()
    expect(reports).toHaveLength(1)
    expect(reports[0]!.metrics.environments).toEqual([
      expect.objectContaining({ modules: 2, resolveCalls: 1 }),
    ])
    expect(reports[0]!.evidence.some((item) => item.kind === 'unresolved-import')).toBe(false)
    expect(reports[0]!.metrics.totalMs).toBeGreaterThan(0)
  })

  it.each(['virtual', 'external'] as const)(
    'does not read a disk namespace when Vite resolves the unchanged import to an %s module',
    async (target) => {
      writeFileSync(localeFile, '{}')
      for (const namespace of ['old', 'actual'])
        writeFileSync(
          path.join(root, `i18n/locales/en-US/${namespace}.json`),
          JSON.stringify({ title: namespace }),
        )
      mkdirSync(path.join(root, 'app'), { recursive: true })
      writeFileSync(path.join(root, 'app/ns.ts'), `export const ns = 'old'`)
      writeFileSync(
        path.join(root, 'app/page.ts'),
        `import { ns } from './ns'; export function page(t: (key: string, options: { ns: string }) => string) { return t('title', { ns: ns }) }`,
      )
      const reports: AnalysisReport[] = []
      await expect(
        build({
          root,
          configFile: false,
          logLevel: 'silent',
          plugins: [
            i18nAnalysisPlugin({
              onAnalysis: (report) => reports.push(report),
              getDeclaredNamespaces: () => ['old'],
            }),
            {
              name: 'virtual-namespace',
              enforce: 'pre',
              resolveId(id) {
                if (id === './ns')
                  return target === 'virtual'
                    ? '\0namespace'
                    : { id: 'external-namespace', external: true }
              },
              load(id) {
                if (id === '\0namespace') return `export const ns = 'actual'`
              },
            },
          ],
          build: { write: false, lib: { entry: path.join(root, 'app/page.ts'), formats: ['es'] } },
        }),
      ).rejects.toThrow(/Undeclared namespace: actual/)
      expect(reports[0]!.evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'unresolved-import', file: 'app/page.ts' }),
        ]),
      )
    },
  )

  it.each(['rewrite', 'inline', 'retained static import', 'retained dynamic import'] as const)(
    'blocks disk fallback after a dynamic import %s',
    async (mode) => {
      writeFileSync(localeFile, '{}')
      for (const namespace of ['old', 'actual'])
        writeFileSync(path.join(root, `i18n/locales/en-US/${namespace}.json`), '{}')
      mkdirSync(path.join(root, 'app'), { recursive: true })
      writeFileSync(path.join(root, 'app/old.ts'), `export const ns = 'old'`)
      writeFileSync(path.join(root, 'app/actual.ts'), `export const ns = 'actual'`)
      writeFileSync(
        path.join(root, 'app/page.ts'),
        `${mode === 'retained static import' ? "import { ns } from './old'; export const keep = ns;" : ''}
      export async function page(t: (key: string, options: { ns: string }) => string) {
      const resource = await import('./old')
      return t('title', { ns: resource.ns })
    }
    ${mode === 'retained dynamic import' ? "export const keep = () => import('./old')" : ''}`,
      )
      const reports: AnalysisReport[] = []
      await expect(
        build({
          root,
          configFile: false,
          logLevel: 'silent',
          plugins: [
            i18nAnalysisPlugin({
              onAnalysis: (report) => reports.push(report),
              getDeclaredNamespaces: () => ['old'],
            }),
            {
              name: 'rewrite-dynamic-import',
              enforce: 'pre',
              transform(code, id) {
                if (id.endsWith('/app/page.ts'))
                  return code.replace(
                    "import('./old')",
                    mode === 'inline' ? "Promise.resolve({ ns: 'actual' })" : "import('./actual')",
                  )
              },
            },
          ],
          build: { write: false, lib: { entry: path.join(root, 'app/page.ts'), formats: ['es'] } },
        }),
      ).rejects.toThrow(/Undeclared namespace: actual/)
      expect(reports[0]!.evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'unresolved-import',
            file: 'app/page.ts',
            message: expect.stringContaining('./old'),
          }),
        ]),
      )
    },
  )

  it('reports untraceable rewrites instead of reading the old runtime module', async () => {
    writeFileSync(localeFile, '{}')
    writeFileSync(path.join(root, 'old.ts'), `export const value = 'old'`)
    writeFileSync(
      path.join(root, 'entry.ts'),
      `import { value } from './old'; export const label = value`,
    )
    const reports: AnalysisReport[] = []
    await build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [
        i18nAnalysisPlugin({ onAnalysis: (report) => reports.push(report) }),
        {
          name: 'inline-import',
          transform(code, id) {
            if (id.endsWith('/entry.ts')) return `export const label = 'actual'`
          },
        },
      ],
      build: { write: false, lib: { entry: path.join(root, 'entry.ts'), formats: ['es'] } },
    })
    expect(reports[0]!.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'unresolved-import',
          file: 'entry.ts',
          line: 1,
          environment: 'client',
        }),
      ]),
    )
  })

  it('connects RSC client stubs to implementation dependencies without scanning their removed bodies', async () => {
    writeFileSync(localeFile, JSON.stringify({ used: 'Used' }))
    mkdirSync(path.join(root, 'app'), { recursive: true })
    writeFileSync(path.join(root, 'app/page.ts'), `export { widget as page } from '../widget'`)
    writeFileSync(
      path.join(root, 'widget.ts'),
      `
      'use strict'; 'use client';
      export { label as widget } from './label'
    `,
    )
    writeFileSync(
      path.join(root, 'label.ts'),
      `export function label(t: (key: string) => string) { return t('app:used') }`,
    )
    const reports: AnalysisReport[] = []
    const builder = await createBuilder({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [
        i18nAnalysisPlugin({ onAnalysis: (report) => reports.push(report) }),
        {
          name: 'client-reference-stub',
          transform(code, id) {
            if (this.environment.name === 'rsc' && id.endsWith('/widget.ts'))
              return `export const widget = 'client reference'`
          },
        },
      ],
      environments: Object.fromEntries(
        ['rsc', 'ssr', 'client'].map((name) => [
          name,
          {
            build: {
              write: false,
              lib: {
                entry: path.join(root, name === 'rsc' ? 'app/page.ts' : 'widget.ts'),
                formats: ['es'],
              },
            },
          },
        ]),
      ),
    })
    await builder.buildApp()
    expect(reports).toHaveLength(1)
    expect(reports[0]!.routes).toMatchObject([{ route: '/', namespaces: ['app'] }])
    expect(reports[0]!.evidence.some((item) => item.kind === 'unresolved-import')).toBe(false)
    const report = reports[0]!
    const paths = report.routes[0]!.groups.page[0]!.dependencyPaths!.map((index) => {
      const chain: AnalysisReport['modules'] = []
      let current: number | null = index
      while (current !== null) {
        const [module, parent]: [number, number | null] = report.paths[current]!
        chain.unshift(report.modules[module]!)
        current = parent
      }
      return chain
    })
    expect(paths).toEqual(
      expect.arrayContaining([
        [
          { environment: 'rsc', moduleId: path.join(root, 'app/page.ts') },
          { environment: 'rsc', moduleId: path.join(root, 'widget.ts') },
          { environment: 'client', moduleId: path.join(root, 'widget.ts') },
          { environment: 'client', moduleId: path.join(root, 'label.ts') },
        ],
      ]),
    )
  })

  it('preserves package declarations after split imports and ignores Vite asset rewrites', async () => {
    writeFileSync(localeFile, JSON.stringify({ used: 'Used', unused: 'Unused' }))
    const directory = path.join(root, 'node_modules/test-hooks')
    mkdirSync(directory, { recursive: true })
    writeFileSync(
      path.join(directory, 'package.json'),
      JSON.stringify({
        name: 'test-hooks',
        type: 'module',
        types: './index.d.ts',
        exports: { '.': './index.js', './identity': './identity.js' },
      }),
    )
    writeFileSync(
      path.join(directory, 'index.js'),
      `export { default as identity } from './identity.js'`,
    )
    writeFileSync(path.join(directory, 'identity.js'), `export default value => value`)
    writeFileSync(
      path.join(directory, 'index.d.ts'),
      `export declare function identity(value: string): 'used'`,
    )
    writeFileSync(path.join(root, 'icon.svg'), '<svg/>')
    writeFileSync(
      path.join(root, 'entry.ts'),
      `
      import { identity } from 'test-hooks'
      import icon from './icon.svg'
      export const asset = identity(icon)
      export function label(t: (key: string) => string, key: ReturnType<typeof identity>) { return t(key) }
    `,
    )
    const reports: AnalysisReport[] = []
    await expect(
      build({
        root,
        configFile: false,
        logLevel: 'silent',
        plugins: [
          i18nAnalysisPlugin({ onAnalysis: (report) => reports.push(report) }),
          {
            name: 'optimize-fixture-imports',
            enforce: 'pre',
            transform(code, id) {
              if (id.endsWith('/entry.ts'))
                return code
                  .replace(
                    "import { identity } from 'test-hooks'",
                    "import identity from 'test-hooks/identity'",
                  )
                  .replace("import icon from './icon.svg'", "const icon = 'data:image/svg+xml,svg'")
            },
          },
        ],
        build: { write: false, lib: { entry: path.join(root, 'entry.ts'), formats: ['es'] } },
      }),
    ).rejects.toThrow(/Found 1 potentially unused i18n keys[\s\S]*app:unused/)
    expect(reports[0]!.evidence.some((item) => item.kind === 'unresolved-import')).toBe(false)
  })

  it('omits opaque dependency diagnostics while retaining application key analysis', async () => {
    writeFileSync(localeFile, JSON.stringify({ used: 'Used', unused: 'Unused' }))
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'opaque-fixture' }))
    const packageDirectory = path.join(root, 'node_modules/actual-package')
    mkdirSync(packageDirectory, { recursive: true })
    writeFileSync(path.join(packageDirectory, 'index.js'), 'export default 1')
    writeFileSync(path.join(root, 'style.css'), '.example { color: red }')
    writeFileSync(
      path.join(root, 'entry.ts'),
      `
      import value from 'package-alias'
      import 'server-only'
      import './style.css'
      import image from './icon.svg?metadata'
      export const dependencies = [value, image]
      export function translate(t: (key: string) => string) { return t('app:used') }
    `,
    )
    const reports: AnalysisReport[] = []
    await expect(
      build({
        root,
        configFile: false,
        logLevel: 'silent',
        plugins: [
          i18nAnalysisPlugin({ onAnalysis: (report) => reports.push(report) }),
          {
            name: 'opaque-dependencies',
            resolveId(id) {
              if (id === 'package-alias') return path.join(packageDirectory, 'index.js')
              if (id === 'server-only' || id === './icon.svg?metadata' || id === 'virtual:helper')
                return `\0${id}`
            },
            load(id) {
              if (id.startsWith('\0')) return 'export default 1'
            },
            transform(code, id) {
              if (id.endsWith('/entry.ts')) return `import 'virtual:helper';\n${code}`
            },
          },
        ],
        build: { write: false, lib: { entry: path.join(root, 'entry.ts'), formats: ['es'] } },
      }),
    ).rejects.toThrow(/Found 1 potentially unused i18n keys[\s\S]*app:unused/)
    expect(reports[0]!.evidence.some((item) => item.kind === 'unresolved-import')).toBe(false)
  })

  it('does not block development when unused translations exist', async () => {
    writeFileSync(localeFile, JSON.stringify({ used: 'Used', unused: 'Unused' }))
    const server = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [i18nAnalysisPlugin()],
      server: { middlewareMode: true, watch: null },
    })
    try {
      await expect(server.transformRequest('/entry.ts')).resolves.toMatchObject({
        code: expect.stringContaining('app:used'),
      })
    } finally {
      await server.close()
    }
  })
})
