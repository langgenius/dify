'use client'

import { useRef } from 'react'
import { useScrollIntersection } from './hooks'

type IntersectionLineProps = {
  intersectionContainerId?: string
}
const IntersectionLine = ({
  intersectionContainerId,
}: IntersectionLineProps) => {
  const ref = useRef<HTMLDivElement>(null)

  useScrollIntersection(ref, intersectionContainerId)

  return (
    <div ref={ref} className='shrink-0 mb-4 h-[1px] bg-transparent'></div>
  )
}

export default IntersectionLine
