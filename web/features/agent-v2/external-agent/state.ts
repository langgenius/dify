'use client'

import type { ExternalAgentListItem } from '../roster/components/external-agent-list'
import type { ExternalAgentOverviewFallbackAgent, ExternalAgentOverviewPreview } from './preview'
import { atom, useAtom } from 'jotai'
import { createExternalRosterPreview } from '../roster/external-roster-preview'
import { createExternalAgentOverviewPreview } from './preview'

// Local UI preview shared by the overview and its parallel sidebar route.
const overviewPreviewsAtom = atom<Record<string, ExternalAgentOverviewPreview>>({})

function resolvePreview(
  agentId: string,
  fallbackAgent?: ExternalAgentOverviewFallbackAgent,
  storedPreview?: ExternalAgentOverviewPreview,
) {
  const rosterAgent = createExternalRosterPreview().find((item) => item.key === agentId)
  const fallback = fallbackAgent?.key === agentId ? fallbackAgent : undefined
  const agent: ExternalAgentListItem = rosterAgent ?? {
    key: agentId,
    name: fallback?.name ?? agentId,
    role: fallback?.role ?? '',
    description: fallback?.description ?? '',
    icon: fallback?.icon,
    enabled: fallback?.enabled ?? false,
    connectedByMe: false,
    createdAt: 0,
    updatedAt: 0,
    apps: [],
  }
  const preview = storedPreview ?? createExternalAgentOverviewPreview(agent)
  if (!fallback) return preview

  return {
    ...preview,
    agent: {
      ...preview.agent,
      name: fallback.name,
      role: fallback.role,
      ...(fallback.icon === undefined ? {} : { icon: fallback.icon }),
      enabled: fallback.enabled,
      description: rosterAgent ? preview.agent.description : fallback.description,
    },
  }
}

export function useExternalAgentPreview(
  agentId: string,
  fallbackAgent?: ExternalAgentOverviewFallbackAgent,
) {
  const [previews, setPreviews] = useAtom(overviewPreviewsAtom)
  const preview = resolvePreview(agentId, fallbackAgent, previews[agentId])
  const updatePreview = (updates: Partial<ExternalAgentOverviewPreview>) => {
    setPreviews((current) => ({
      ...current,
      [agentId]: { ...resolvePreview(agentId, fallbackAgent, current[agentId]), ...updates },
    }))
  }
  return { preview, updatePreview }
}
