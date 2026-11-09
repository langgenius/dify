'use client'

import type { ComponentProps, ReactNode } from 'react'
import type { StudioListPath } from './list-navigation-state'
import { createContext, use } from 'react'
import Link from '@/next/link'
import { useRouter } from '@/next/navigation'
import { useRememberStudioListHref } from './list-navigation-state'

type LinkProps = ComponentProps<typeof Link>
type NavigationEvent = Parameters<NonNullable<LinkProps['onNavigate']>>[0]
type NavigationOptions = Pick<LinkProps, 'replace' | 'scroll'>

const NavigationContext = createContext<
  ((event: NavigationEvent, href: string, options: NavigationOptions) => void) | null
>(null)

export function StudioListNavigation({
  path,
  href,
  flush,
  children,
}: {
  path: StudioListPath
  href: string
  flush: () => Promise<URLSearchParams>
  children: ReactNode
}) {
  useRememberStudioListHref(path, href)
  const router = useRouter()

  const navigate = (event: NavigationEvent, destination: string, options: NavigationOptions) => {
    event.preventDefault()
    // Finish debounced URL writes before creating the detail page's history entry.
    void flush().then(() => {
      const navigateTo = options.replace ? router.replace : router.push
      navigateTo(destination, { scroll: options.scroll })
    })
  }

  return <NavigationContext value={navigate}>{children}</NavigationContext>
}

export function StudioListLink({
  href,
  replace,
  scroll,
  ...props
}: Omit<LinkProps, 'href' | 'onNavigate'> & { href: string }) {
  const navigate = use(NavigationContext)

  return (
    <Link
      {...props}
      href={href}
      replace={replace}
      scroll={scroll}
      onNavigate={navigate ? (event) => navigate(event, href, { replace, scroll }) : undefined}
    />
  )
}
