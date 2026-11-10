'use client'

import type { ExternalAgentOverviewPreview } from './preview'
import { atom, useAtom } from 'jotai'
import { createExternalRosterPreview } from '../roster/external-roster-preview'
import { createExternalAgentOverviewPreview } from './preview'

// Local UI preview shared by the overview and its parallel sidebar route.
const overviewPreviewsAtom = atom<Record<string, ExternalAgentOverviewPreview>>({})

function createPreview(agentId: string) {
  const agents = createExternalRosterPreview()
  const agent = agents.find((item) => item.key === agentId) ?? agents[1]
  if (!agent) throw new Error('Missing external agent preview data')
  return createExternalAgentOverviewPreview({ ...agent, key: agentId })
}

export function useExternalAgentPreview(agentId: string) {
  const [previews, setPreviews] = useAtom(overviewPreviewsAtom)
  const preview = previews[agentId] ?? createPreview(agentId)
  const updatePreview = (updates: Partial<ExternalAgentOverviewPreview>) => {
    setPreviews((current) => ({
      ...current,
      [agentId]: { ...(current[agentId] ?? createPreview(agentId)), ...updates },
    }))
  }
  return { preview, updatePreview }
}
