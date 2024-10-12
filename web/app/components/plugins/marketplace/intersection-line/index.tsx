'use client'

import { useRef } from 'react'
import { useScrollIntersection } from './hooks'

type IntersectionLineProps = {
  containerRef: React.RefObject<HTMLDivElement>
  intersectedCallback: (isIntersecting: boolean) => void
}
const IntersectionLine = ({
  containerRef,
  intersectedCallback,
}: IntersectionLineProps) => {
  const ref = useRef<HTMLDivElement>(null)

  useScrollIntersection(
    containerRef,
    ref,
    intersectedCallback,
  )

  return (
    <div ref={ref} className='h-[1px] bg-transparent'></div>
  )
}

export default IntersectionLine
