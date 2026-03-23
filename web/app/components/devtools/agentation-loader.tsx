'use client'

import type { ComponentType } from 'react'
import { useEffect, useState } from 'react'
import { IS_DEV } from '@/config'

const AgentationLoader = () => {
  const [AgentationComponent, setAgentationComponent] = useState<ComponentType | null>(null)

  useEffect(() => {
    if (!IS_DEV)
      return

    let cancelled = false

    void import('agentation').then((module) => {
      if (!cancelled)
        setAgentationComponent(() => module.Agentation)
    }).catch((error) => {
      console.error('Failed to load Agentation', error)
    })

    return () => {
      cancelled = true
    }
  }, [])

  if (!IS_DEV || !AgentationComponent)
    return null

  return <AgentationComponent />
}

export default AgentationLoader
