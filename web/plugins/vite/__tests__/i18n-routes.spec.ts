// @vitest-environment node
import { describe, expect, it } from 'vite-plus/test'
import { analyzeRouteNamespaces, validateRouteNamespaces } from '../i18n-analysis/routes'

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
