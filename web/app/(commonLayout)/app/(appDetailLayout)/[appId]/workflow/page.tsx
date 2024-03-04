'use client'

import { memo } from 'react'
import Workflow from '@/app/components/workflow'

const Page = () => {
  const nodes = [
    {
      id: '1',
      type: 'custom',
      position: { x: 0, y: 0 },
      data: { type: 'start' },
    },
  ]
  return (
    <Workflow
      nodes={nodes}
      edges={[]}
    />
  )
}
export default memo(Page)
