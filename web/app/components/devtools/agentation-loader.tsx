'use client'

import { IS_DEV } from '@/config'
import dynamic from '@/next/dynamic'

const Agentation = dynamic(() => import('agentation').then(module => module.Agentation), { ssr: false })

export function AgentationLoader() {
  if (!IS_DEV)
    return null

  return <Agentation />
}
