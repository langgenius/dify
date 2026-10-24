'use client'

import type { ComponentProps, ReactNode } from 'react'
import type { StudioListPath } from '.'
import { useAtomValue, useSetAtom } from 'jotai'
import { createContext, use, useEffect } from 'react'
import { currentWorkspaceIdAtom } from '@/context/workspace-state'
import Link from '@/next/link'
import { useRouter } from '@/next/navigation'
import { listHrefsAtom } from '.'

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
  const workspaceId = useAtomValue(currentWorkspaceIdAtom)
  const setListHrefs = useSetAtom(listHrefsAtom)
  const router = useRouter()

  // Retain this route's destination after it unmounts; filters are always read from the URL.
  useEffect(() => {
    if (!workspaceId) return

    setListHrefs((previous) => {
      if (previous[workspaceId]?.[path] === href) return previous

      return { ...previous, [workspaceId]: { ...previous[workspaceId], [path]: href } }
    })
  }, [href, path, setListHrefs, workspaceId])

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
