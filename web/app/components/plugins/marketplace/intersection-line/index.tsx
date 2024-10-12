'use client'

import { useRef } from 'react'
import { useScrollIntersection } from './hooks'

const IntersectionLine = () => {
  const ref = useRef<HTMLDivElement>(null)

  useScrollIntersection(ref)

  return (
    <div ref={ref} className='h-[1px] bg-transparent'></div>
  )
}

export default IntersectionLine
