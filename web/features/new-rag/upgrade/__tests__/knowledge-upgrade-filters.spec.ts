import type { KnowledgeUpgrade } from '../knowledge-upgrade-context-value'
import { describe, expect, it } from 'vite-plus/test'
import { matchesKnowledgeUpgradeFilters } from '../knowledge-upgrade-filters'

const upgrade = {
  dataset: {
    description: 'Answers for customer support',
    maintainer: 'account-1',
    name: 'Support knowledge',
    tags: [
      { id: 'tag-1', name: 'Support' },
      { id: 'tag-2', name: 'Public' },
    ],
  },
} as KnowledgeUpgrade

describe('matchesKnowledgeUpgradeFilters', () => {
  it('matches case-insensitive name and description searches', () => {
    expect(
      matchesKnowledgeUpgradeFilters(upgrade, {
        creatorIds: [],
        query: 'SUPPORT KNOWLEDGE',
        tagIds: [],
      }),
    ).toBe(true)
    expect(
      matchesKnowledgeUpgradeFilters(upgrade, {
        creatorIds: [],
        query: 'customer support',
        tagIds: [],
      }),
    ).toBe(true)
    expect(
      matchesKnowledgeUpgradeFilters(upgrade, {
        creatorIds: [],
        query: 'engineering',
        tagIds: [],
      }),
    ).toBe(false)
  })

  it('uses match-any semantics for tags and requires a selected creator', () => {
    expect(
      matchesKnowledgeUpgradeFilters(upgrade, {
        creatorIds: ['account-1'],
        query: '',
        tagIds: ['missing-tag', 'tag-2'],
      }),
    ).toBe(true)
    expect(
      matchesKnowledgeUpgradeFilters(upgrade, {
        creatorIds: ['account-2'],
        query: '',
        tagIds: ['tag-2'],
      }),
    ).toBe(false)
  })
})
