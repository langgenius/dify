import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import type { Context, ReactNode } from 'react'
import type { Mock } from 'vite-plus/test'
import {
  AppRouterContext,
  LayoutRouterContext,
} from 'next/dist/shared/lib/app-router-context.shared-runtime'
import {
  PathnameContext,
  PathParamsContext,
  SearchParamsContext,
} from 'next/dist/shared/lib/hooks-client-context.shared-runtime'
import { useSyncExternalStore } from 'react'
import { vi } from 'vite-plus/test'

type RouteParams = Record<string, string | string[]>

type TestNavigationOptions = {
  /** The current URL, such as `/apps?tag=workflow`. Defaults to `/`. */
  url?: string
  /** Dynamic route params returned by `useParams`. */
  params?: RouteParams
  /**
   * Active child segments below the rendering layout, read by `useSelectedLayoutSegment(s)`,
   * such as `['logs']` for a link inside the app detail layout at `/app/app-1/logs`.
   */
  segments?: string[]
}

type LayoutRouterValue = NonNullable<ContextValue<typeof LayoutRouterContext>>
type ContextValue<C> = C extends Context<infer V> ? V : never

// The minimal layout context `useSelectedLayoutSegment(s)` and `useRouter` read: a route tree whose
// `children` slot descends through the given segments to a page.
function createLayoutRouterValue(segments: string[]): LayoutRouterValue {
  let node: unknown = ['__PAGE__', {}]
  for (const segment of [...segments].reverse()) node = [segment, { children: node }]
  return {
    parentTree: ['', { children: node }],
    parentRenderTree: { data: { bfcacheId: 0 } },
  } as unknown as LayoutRouterValue
}

type NavigateSpy = Mock<AppRouterInstance['push']>

type TestRouter = Omit<AppRouterInstance, 'push' | 'replace'> & {
  push: NavigateSpy
  replace: NavigateSpy
  back: Mock<() => void>
  forward: Mock<() => void>
  refresh: Mock<() => void>
  prefetch: Mock<AppRouterInstance['prefetch']>
}

export type TestNavigation = {
  /**
   * Records every navigation. A navigation within the current pathname updates the URL, as Next
   * keeps that page mounted; one to another pathname does not, because it would replace the page.
   */
  router: TestRouter
  /** Provides Next's real navigation contexts, so `@/next/navigation` hooks stay unmocked. */
  NavigationProvider: (props: { children: ReactNode }) => ReactNode
  /** The current URL, as `pathname + search`. */
  url: () => string
  /**
   * Moves the current URL, as a route update to the mounted page (back button, a parent link).
   * Pass `params` when the update changes dynamic route params, such as `/form/[token]`.
   */
  navigate: (url: string, options?: { params?: RouteParams }) => void
}

const ORIGIN = 'http://test.local'

/**
 * Real `useRouter`, `usePathname`, `useSearchParams` and `useParams` for component tests.
 * Each call returns an isolated router; render the component inside its `NavigationProvider`.
 */
export function createTestNavigation({
  url: initialUrl = '/',
  params = {},
  segments,
}: TestNavigationOptions = {}): TestNavigation {
  const layout = segments ? createLayoutRouterValue(segments) : null
  let current = new URL(initialUrl, ORIGIN)
  let snapshot = {
    pathname: current.pathname,
    searchParams: new URLSearchParams(current.search),
    params,
  }
  const listeners = new Set<() => void>()

  const navigate: TestNavigation['navigate'] = (href, options) => {
    current = new URL(href, current)
    snapshot = {
      pathname: current.pathname,
      searchParams: new URLSearchParams(current.search),
      params: options?.params ?? snapshot.params,
    }
    listeners.forEach((listener) => listener())
  }
  // Next keeps the page mounted when only the query changes, so apply those navigations; a new
  // pathname would replace the page, which a mounted component never observes.
  const followSameRoute = (href: string) => {
    if (new URL(href, current).pathname === current.pathname) navigate(href)
  }
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  const router: TestRouter = {
    push: vi.fn<AppRouterInstance['push']>(followSameRoute),
    replace: vi.fn<AppRouterInstance['replace']>(followSameRoute),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn<AppRouterInstance['prefetch']>(),
    bfcacheId: '_b_0_',
  }

  function NavigationProvider({ children }: { children: ReactNode }) {
    const { pathname, searchParams, params } = useSyncExternalStore(subscribe, () => snapshot)
    return (
      <AppRouterContext value={router}>
        <PathnameContext value={pathname}>
          <SearchParamsContext value={searchParams}>
            <PathParamsContext value={params}>
              <LayoutRouterContext value={layout}>{children}</LayoutRouterContext>
            </PathParamsContext>
          </SearchParamsContext>
        </PathnameContext>
      </AppRouterContext>
    )
  }

  return {
    router,
    NavigationProvider,
    url: () => `${current.pathname}${current.search}`,
    navigate,
  }
}
