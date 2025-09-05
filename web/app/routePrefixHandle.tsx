'use client'

import { basePath } from '@/utils/var'
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

export default function RoutePrefixHandle() {
  const pathname = usePathname()
  const handleRouteChange = () => {
    const addPrefixToImg = (e: HTMLImageElement) => {
      const url = new URL(e.src)
      const prefix = url.pathname.slice(0, basePath.length)
      if (prefix !== basePath && !url.href.startsWith('blob:') && !url.href.startsWith('data:') && !url.href.startsWith('http')) {
        url.pathname = basePath + url.pathname
        e.src = url.toString()
      }
    }
    // create an observer instance
    const observer = new MutationObserver((mutationsList) => {
      for (const mutation of mutationsList) {
        if (mutation.type === 'childList') {
          // listen for newly added img tags
          mutation.addedNodes.forEach((node) => {
            if (((node as HTMLElement).tagName) === 'IMG')
              addPrefixToImg(node as HTMLImageElement)
          })
        }
        else if (mutation.type === 'attributes' && (mutation.target as HTMLElement).tagName === 'IMG') {
          // if the src of an existing img tag changes, update the prefix
          if (mutation.attributeName === 'src')
            addPrefixToImg(mutation.target as HTMLImageElement)
        }
      }
    })

    // configure observation options
    const config = {
      childList: true,
      attributes: true,
      subtree: true,
      attributeFilter: ['src'],
    }

    observer.observe(document.body, config)
  }

  useEffect(() => {
    if (basePath)
      handleRouteChange()
  }, [pathname])

  return null
}
