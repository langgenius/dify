'use client'

import dynamic from 'next/dynamic'

const Agentation =
  process.env.NODE_ENV === 'development'
    ? dynamic(() => import('agentation').then((module) => module.Agentation), { ssr: false })
    : null

const IS_AGENTATION_ENABLED = process.env.NEXT_PUBLIC_ENABLE_AGENTATION !== 'false'

export function AgentationLoader() {
  if (!Agentation || !IS_AGENTATION_ENABLED) return null

  return <Agentation />
}
