import type { CommonNodeType, Node } from '@/app/components/workflow/types'
import { describe, expect, it } from 'vitest'
import { BlockEnum } from '@/app/components/workflow/types'
import {
  classifyHumanInputVersion,
  getHumanInputCreationPolicy,
  HumanInputVersionKind,
  isLegacyHumanInputNodeData,
  isMigrationEligibleHumanInputNodeData,
} from '../policy'

const data = (version?: unknown, type = BlockEnum.HumanInput) =>
  ({
    type,
    title: 'Human Input',
    desc: '',
    ...(version === undefined ? {} : { version }),
  }) as CommonNodeType
const node = (version?: unknown): Pick<Node, 'data'> => ({ data: data(version) })

describe('Human Input migration policy', () => {
  it.each([
    [undefined, HumanInputVersionKind.LegacyEligible, true],
    ['1', HumanInputVersionKind.LegacyEligible, true],
    ['2', HumanInputVersionKind.V2, false],
    [2, HumanInputVersionKind.LegacyBlocked, false],
    ['3', HumanInputVersionKind.LegacyBlocked, false],
    [null, HumanInputVersionKind.LegacyBlocked, false],
  ])('classifies persisted version %p', (version, expectedKind, eligible) => {
    expect(classifyHumanInputVersion(data(version))).toBe(expectedKind)
    expect(isMigrationEligibleHumanInputNodeData(data(version))).toBe(eligible)
    expect(isLegacyHumanInputNodeData(data(version))).toBe(
      expectedKind !== HumanInputVersionKind.V2,
    )
  })

  it('ignores non-Human Input data even when it has version 2', () => {
    expect(classifyHumanInputVersion(data('2', BlockEnum.Code))).toBe(
      HumanInputVersionKind.NotHumanInput,
    )
    expect(isLegacyHumanInputNodeData(data('2', BlockEnum.Code))).toBe(false)
  })

  it.each([
    ['new editable workflow', [], true, false, true],
    ['v2-only workflow', [node('2')], true, false, true],
    ['legacy-only workflow', [node()], true, true, false],
    ['mixed workflow', [node(), node('2')], true, true, false],
    ['migrated workflow', [node('2'), node('2')], true, false, true],
    ['legacy removed workflow', [], true, false, true],
    ['read-only workflow', [node('2')], false, false, false],
    ['read-only legacy workflow', [node()], false, true, false],
  ])(
    '%s exposes one candidate with the expected state',
    (_name, nodes, canEdit, hasLegacy, canAdd) => {
      expect(getHumanInputCreationPolicy(nodes, canEdit)).toEqual({
        hasLegacyHumanInput: hasLegacy,
        canAddHumanInputV2: canAdd,
        candidateCount: 1,
      })
    },
  )
})
