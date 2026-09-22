// @vitest-environment node
import { describe, expect, it } from 'vite-plus/test'
import {
  analyzeEnvironmentRoutes,
  analyzeRouteNamespaces,
  validateRouteNamespaces,
} from '../i18n-analysis/routes'

describe('route namespace analysis', () => {
  it('includes ancestor boundaries and parallel slots without leaking sibling layouts', () => {
    const usage = new Map(
      Object.entries({
        '/web/app/layout.tsx': ['common'],
        '/web/app/(console)/layout.tsx': ['console'],
        '/web/app/(console)/items/page.tsx': ['items'],
        '/web/app/(console)/items/loading.tsx': ['loading'],
        '/web/app/(console)/items/error.tsx': ['error'],
        '/web/app/(console)/@sidebar/default.tsx': ['sidebar'],
        '/web/app/(console)/@sidebar/detail/page.tsx': ['detail'],
        '/web/app/(public)/layout.tsx': ['public'],
        '/web/app/(public)/page.tsx': [],
        '/web/shared.ts': ['shared'],
        '/web/lazy.ts': ['items', 'lazy'],
      }).map(([id, namespaces]) => [id, new Set(namespaces)]),
    )
    const dependencies = new Map([
      ['/web/lazy.ts', { static: new Set(['/web/shared.ts']), dynamic: new Set<string>() }],
      [
        '/web/app/(console)/items/page.tsx',
        { static: new Set(['\0virtual-component']), dynamic: new Set(['/web/lazy.ts']) },
      ],
      ['\0virtual-component', { static: new Set(['/web/shared.ts']), dynamic: new Set<string>() }],
      ['/web/shared.ts', { static: new Set(['\0virtual-component']), dynamic: new Set<string>() }],
    ])
    const report = analyzeRouteNamespaces('/web', dependencies, usage)
    expect(report.find((item) => item.page === 'app/(console)/items/page.tsx')).toMatchObject({
      route: '/items',
      page: 'app/(console)/items/page.tsx',
      namespaces: [
        'common',
        'console',
        'detail',
        'error',
        'items',
        'lazy',
        'loading',
        'shared',
        'sidebar',
      ],
    })
    expect(() => validateRouteNamespaces(report, () => undefined)).not.toThrow()
    expect(() =>
      validateRouteNamespaces(report, (route) =>
        route === '/items'
          ? [
              'common',
              'console',
              'detail',
              'error',
              'items',
              'lazy',
              'loading',
              'shared',
              'sidebar',
            ]
          : undefined,
      ),
    ).not.toThrow()
    expect(() =>
      validateRouteNamespaces(report, (route) => (route === '/items' ? [] : undefined)),
    ).toThrow(
      /Route namespace declarations[\s\S]*\/items[\s\S]*\[shared\] app\/layout.tsx[\s\S]*\[slots\][\s\S]*\[page\][\s\S]*\[lazy\] lazy.ts/,
    )
    const groups = report.find((item) => item.page === 'app/(console)/items/page.tsx')!.groups
    expect(groups.page).toEqual([
      { namespace: 'items', sources: ['app/(console)/items/page.tsx'] },
      { namespace: 'shared', sources: ['shared.ts'] },
    ])
    expect(groups.lazy).toEqual([
      { namespace: 'items', sources: ['lazy.ts'] },
      { namespace: 'lazy', sources: ['lazy.ts'] },
    ])
    expect(groups.slots).toEqual([
      { namespace: 'detail', sources: ['app/(console)/@sidebar/detail/page.tsx'] },
      { namespace: 'sidebar', sources: ['app/(console)/@sidebar/default.tsx'] },
    ])
    expect(report.find((item) => item.page === 'app/(public)/page.tsx')).toMatchObject({
      route: '/',
      page: 'app/(public)/page.tsx',
      namespaces: ['common', 'public'],
      groups: { page: [], lazy: [], slots: [] },
    })
  })
})

describe('environment route boundaries', () => {
  const edge = (ids: string[]) => ({ static: new Set(ids), dynamic: new Set<string>() })
  it('shares dependency paths across routes and namespaces', () => {
    const report = analyzeEnvironmentRoutes(
      '/web',
      new Map([
        [
          'client',
          {
            usage: new Map([
              ['/web/app/a/page.ts', new Set<string>()],
              ['/web/app/b/page.ts', new Set<string>()],
              ['/web/app/layout.ts', new Set<string>()],
              ['/web/shared.ts', new Set(['common', 'app'])],
            ]),
            dependencies: new Map([
              ['/web/app/layout.ts', edge(['/web/shared.ts'])],
              ['/web/shared.ts', edge(['/web/app/layout.ts'])],
            ]),
            clientReferences: new Set<string>(),
          },
        ],
      ]),
    )
    expect(report.routes).toHaveLength(2)
    const references = report.routes.flatMap((route) =>
      route.groups.shared.flatMap((group) => group.dependencyPaths!),
    )
    expect(references).toHaveLength(4)
    expect(new Set(references).size).toBe(1)
    const [moduleIndex, parentIndex] = report.paths[references[0]!]!
    expect(report.modules[moduleIndex]).toEqual({
      environment: 'client',
      moduleId: '/web/shared.ts',
    })
    const [rootIndex, rootParent] = report.paths[parentIndex!]!
    expect(report.modules[rootIndex]).toEqual({
      environment: 'client',
      moduleId: '/web/app/layout.ts',
    })
    expect(rootParent).toBeNull()
    expect(report.paths).toHaveLength(2)
  })

  it('does not combine unrelated paths from different environments', () => {
    const usage = new Map([
      ['/web/app/page.ts', new Set<string>()],
      ['/web/bridge.ts', new Set<string>()],
      ['/web/extra.ts', new Set(['extra'])],
    ])
    const graphs = new Map([
      [
        'client',
        {
          usage,
          dependencies: new Map([['/web/app/page.ts', edge(['/web/bridge.ts'])]]),
          clientReferences: new Set<string>(),
        },
      ],
      [
        'ssr',
        {
          usage,
          dependencies: new Map([['/web/bridge.ts', edge(['/web/extra.ts'])]]),
          clientReferences: new Set<string>(),
        },
      ],
    ])
    expect(analyzeEnvironmentRoutes('/web', graphs).routes[0]!.namespaces).toEqual([])
  })

  it('follows explicit client references into both SSR and client implementations', () => {
    const graphs = new Map([
      [
        'rsc',
        {
          usage: new Map([
            ['/web/app/page.ts', new Set<string>()],
            ['/web/widget.tsx', new Set<string>()],
          ]),
          dependencies: new Map([
            ['/web/app/page.ts', edge(['/web/widget.tsx'])],
            ['/web/widget.tsx', edge([])],
          ]),
          clientReferences: new Set(['/web/widget.tsx']),
        },
      ],
      [
        'ssr',
        {
          usage: new Map([
            ['/web/widget.tsx', new Set<string>()],
            ['/web/server-label.ts', new Set(['server'])],
          ]),
          dependencies: new Map([['/web/widget.tsx', edge(['/web/server-label.ts'])]]),
          clientReferences: new Set<string>(),
          unknownNamespaces: new Set(['/web/server-label.ts']),
        },
      ],
      [
        'client',
        {
          usage: new Map([
            ['/web/widget.tsx', new Set<string>()],
            ['/web/browser-label.ts', new Set(['browser'])],
          ]),
          dependencies: new Map([['/web/widget.tsx', edge(['/web/browser-label.ts'])]]),
          clientReferences: new Set<string>(),
        },
      ],
    ])
    expect(analyzeEnvironmentRoutes('/web', graphs).routes).toMatchObject([
      {
        route: '/',
        namespaces: ['browser', 'server'],
        unknownNamespaceSources: ['server-label.ts'],
      },
    ])
  })
})
