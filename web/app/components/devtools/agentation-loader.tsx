'use client'

import type { ComponentType } from 'react'
import { useEffect, useState } from 'react'
import { IS_DEV } from '@/config'

const AgentationLoader = () => {
  const [AgentationComponent, setAgentationComponent] = useState<ComponentType | null>(null)

  useEffect(() => {
    if (!IS_DEV)
      return

    void import('agentation').then((module) => {
      setAgentationComponent(() => module.Agentation)
    })
  }, [])

  if (!IS_DEV || !AgentationComponent)
    return null

  return <AgentationComponent />
}

export default AgentationLoader
