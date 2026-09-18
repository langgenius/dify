// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build, createBuilder, createLogger, createServer } from 'vite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { i18nAnalysisPlugin } from '../i18n-analysis'

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
    expect(reports[0]).toContain(
      '/items/[id] (app/(group)/items/[id]/page.ts): client, common, group, lazy, ssr',
    )
    expect(reports[0]).toContain('/other (app/other/page.ts): common, other')
    expect(reports[0]).toContain('    page: client, ssr')
    expect(reports[0]).toContain('    shared: common, group')
    expect(reports[0]).toContain('    lazy: lazy')
    expect(reports[0]).not.toContain('ignored')
    const artifact: unknown = JSON.parse(
      readFileSync(path.join(root, 'dist/i18n-routes.json'), 'utf8'),
    )
    expect(artifact).toMatchObject({
      version: 1,
      routes: expect.arrayContaining([
        expect.objectContaining({
          route: '/items/[id]',
          groups: {
            page: [
              { namespace: 'client', sources: ['component.ts'] },
              { namespace: 'ssr', sources: ['component.ts'] },
            ],
            shared: [
              { namespace: 'common', sources: ['app/layout.ts'] },
              { namespace: 'group', sources: ['app/(group)/layout.ts'] },
            ],
            lazy: [{ namespace: 'lazy', sources: ['lazy.ts'] }],
            slots: [],
          },
        }),
      ]),
    })
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
