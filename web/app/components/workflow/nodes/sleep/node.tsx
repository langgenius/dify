import type { FC } from 'react'
import React from 'react'
import type { SleepNodeType } from './types'
import type { NodeProps } from '@/app/components/workflow/types'

const Node: FC<NodeProps<SleepNodeType>> = () => {
  return null
}

export default React.memo(Node)
