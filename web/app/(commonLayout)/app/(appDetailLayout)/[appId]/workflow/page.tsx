'use client'

import { memo } from 'react'
import Workflow from '@/app/components/workflow'

const Page = () => {
  const nodes = [
    {
      id: '1',
      type: 'custom',
      position: { x: 180, y: 180 },
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
