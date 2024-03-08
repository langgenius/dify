'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
// import cn from 'classnames'
import { BlockEnum } from '../types'
import NodePanel from './node'

type TracingProps = {
  // appId: string
}

const nodeInfoFake = {
  type: BlockEnum.Start,
  title: 'START',
  time: 67.349,
  tokens: 2708,
  status: 'succeeded',
}

const Tracing: FC<TracingProps> = () => {
  const { t } = useTranslation()
  const [nodeCollapsed, setCurrentTab] = useState<boolean>(false)

  const collapseStateChange = () => {
    setCurrentTab(!nodeCollapsed)
  }

  return (
    <div className='bg-gray-50 py-2'>
      <NodePanel nodeInfo={nodeInfoFake} collapsed={nodeCollapsed} collapseHandle={collapseStateChange} />
    </div>
  )
}

export default Tracing
