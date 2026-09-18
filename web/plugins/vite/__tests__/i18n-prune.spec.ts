// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build, createBuilder, createServer } from 'vite'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { i18nPrunePlugin } from '../i18n-prune'

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
      plugins: [i18nPrunePlugin()],
      build: {
        write: false,
        lib: { entry: path.join(root, 'entry.ts'), formats: ['es'] },
      },
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

  it('checks the union of client, SSR and RSC graphs only after every environment builds', async () => {
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
      plugins: [i18nPrunePlugin()],
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
  })

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
        i18nPrunePlugin(),
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
        i18nPrunePlugin(),
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
      plugins: [i18nPrunePlugin()],
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
