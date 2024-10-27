import type { ReadonlyURLSearchParams } from 'next/navigation'

declare module 'next/navigation' {
  /**
   * Get a read-only URLSearchParams object. For example searchParams.get('foo') would return 'bar' when ?foo=bar
   * Learn more about URLSearchParams here: https://developer.mozilla.org/docs/Web/API/URLSearchParams
   *
   * If used from `pages/`, the hook may return `null` when the router is not
   * ready.
   */
  export function useSearchParams(): ReadonlyURLSearchParams | null

  /**
   * Get the current pathname. For example, if the URL is
   * https://example.com/foo?bar=baz, the pathname would be /foo.
   *
   * If the hook is accessed from `pages/`, the pathname may be `null` when the
   * router is not ready.
   */
  export function usePathname(): string | null

  /**
   * Get the current parameters. For example useParams() on /dashboard/[team]
   * where pathname is /dashboard/nextjs would return { team: 'nextjs' }
   *
   * If used from `pages/`, the hook will return `null`.
   */
  export function useParams<
    T extends Record<string, string | string[]> = Record<
      string,
      string | string[]
    >,
  >(): T | null

  /**
   * A [Client Component](https://nextjs.org/docs/app/building-your-application/rendering/client-components) hook
   * that lets you read the active route segments **below** the Layout it is called from.
   *
   * If used from `pages/`, the hook will return `null`.
   */
  export function useSelectedLayoutSegments(): string[] | null

  /**
   * A [Client Component](https://nextjs.org/docs/app/building-your-application/rendering/client-components) hook
   * that lets you read the active route segment **one level below** the Layout it is called from.
   *
   * If used from `pages/`, the hook will return `null`.
   */
  export function useSelectedLayoutSegment(): string | null
}
