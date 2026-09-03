'use client'

import { IS_DEV } from '@/config'
import dynamic from '@/next/dynamic'

const Agentation = dynamic(() => import('agentation').then((module) => module.Agentation), {
  ssr: false,
})

const IS_AGENTATION_ENABLED = process.env.NEXT_PUBLIC_ENABLE_AGENTATION !== 'false'

export function AgentationLoader() {
  if (!IS_DEV || !IS_AGENTATION_ENABLED) return null

  return <Agentation />
}
