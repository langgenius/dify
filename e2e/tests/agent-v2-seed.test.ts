import { describe, expect, it } from 'vitest'
import { createAgentV2SeedTasks } from '../features/agent-v2/support/seed'

const baseTaskIds = [
  'marketplace-plugins',
  'stable-model',
  'agent-decision-model',
  'tool:JSON Process / JSON Replace',
  'tool:Tavily / Tavily Search',
  'ready-knowledge',
]

const preparedFixtureTaskIds = [
  'full-config-agent',
  'tool-states-agent',
  'dual-retrieval-agent',
  'workflow-reference',
]

const taskIds = (profile: string) => createAgentV2SeedTasks(profile).map((task) => task.id)

describe('Agent v2 seed profiles', () => {
  it('prepares every fixture required by prepared behavior', () => {
    expect(taskIds('prepared')).toEqual([...baseTaskIds, ...preparedFixtureTaskIds])
  })

  it('prepares external runtime and prepared behavior in post-merge', () => {
    expect(taskIds('post-merge')).toEqual([
      ...baseTaskIds,
      'speech-to-text-model',
      ...preparedFixtureTaskIds,
    ])
  })

  it('rejects unknown profiles', () => {
    expect(() => createAgentV2SeedTasks('unknown')).toThrow(
      'Unknown Agent V2 seed profile "unknown".',
    )
  })
})
