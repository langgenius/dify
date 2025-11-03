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
    <div ref={ref} className='mb-4 h-px shrink-0 bg-transparent'></div>
  )
}

export default IntersectionLine
