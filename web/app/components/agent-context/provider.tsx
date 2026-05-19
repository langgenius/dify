'use client'

import { useEffect } from 'react'
import { registerDifyAgentTools } from './runtime'
import { buildDifyAgentTools } from './tools'

let registered = false

const ensureAgentToolsRegistered = () => {
  if (registered || typeof window === 'undefined')
    return

  registerDifyAgentTools(buildDifyAgentTools())
  registered = true
}

ensureAgentToolsRegistered()

export function AgentContextProvider() {
  useEffect(() => {
    ensureAgentToolsRegistered()
  }, [])

  return null
}
