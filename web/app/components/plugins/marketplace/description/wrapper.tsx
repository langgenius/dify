'use client'

import type { ReactNode } from 'react'
import { useCallback } from 'react'
import IntersectionLine from '../intersection-line'
import { usePluginPageContext } from '@/app/components/plugins/plugin-page/context'

type DescriptionWrapperProps = {
  children: ReactNode
}
const DescriptionWrapper = ({
  children,
}: DescriptionWrapperProps) => {
  const containerRef = usePluginPageContext(v => v.containerRef)
  const scrollDisabled = usePluginPageContext(v => v.scrollDisabled)
  const setScrollDisabled = usePluginPageContext(v => v.setScrollDisabled)

  const handleScrollIntersectionChange = useCallback((isIntersecting: boolean) => {
    if (!isIntersecting && !scrollDisabled) {
      setScrollDisabled(true)
      setTimeout(() => {
        if (containerRef && containerRef.current)
          containerRef.current.scrollTop = 0
      }, 100)
    }
  }, [containerRef, scrollDisabled, setScrollDisabled])

  return !scrollDisabled && (
    <>
      {children}
      <IntersectionLine
        containerRef={containerRef}
        intersectedCallback={handleScrollIntersectionChange}
      />
    </>
  )
}

export default DescriptionWrapper
