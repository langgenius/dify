import type { CommonNodeType, Node } from '@/app/components/workflow/types'
import { describe, expect, it } from 'vitest'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import { createDefaultFormInputByType } from '../../../human-input/types'
import {
  canInsertHumanInput,
  canInsertHumanInputNodes,
  classifyHumanInputVersion,
  getHumanInputCreationPolicy,
  HumanInputVersionKind,
  isLegacyHumanInputNodeData,
} from '../policy'

const data = (version?: unknown, type: BlockEnum = BlockEnum.HumanInput) =>
  ({
    type,
    title: 'Human Input',
    desc: '',
    ...(version === undefined ? {} : { version }),
  }) as CommonNodeType
const node = (version?: unknown): Pick<Node, 'data'> => ({ data: data(version) })

describe('Human Input migration policy', () => {
  it.each([
    [undefined, HumanInputVersionKind.LegacyEligible],
    ['1', HumanInputVersionKind.LegacyEligible],
    ['2', HumanInputVersionKind.V2],
    [2, HumanInputVersionKind.LegacyBlocked],
    ['3', HumanInputVersionKind.LegacyBlocked],
    [null, HumanInputVersionKind.LegacyBlocked],
  ])('classifies persisted version %p', (version, expectedKind) => {
    expect(classifyHumanInputVersion(data(version))).toBe(expectedKind)
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
        canAddLegacyHumanInput: false,
        candidateCount: 1,
      })
    },
  )

  it.each([InputVarType.select, InputVarType.singleFile, InputVarType.multiFiles])(
    'keeps legacy insertion available when %s fields cannot migrate',
    (type) => {
      const legacy = {
        data: {
          ...data(),
          inputs: [createDefaultFormInputByType(type, 'decision')],
        },
      }

      expect(canInsertHumanInput([legacy], BlockEnum.HumanInput)).toBe(true)
      expect(canInsertHumanInput([legacy], BlockEnum.HumanInputV2)).toBe(false)
      expect(canInsertHumanInput([legacy, node('2')], BlockEnum.HumanInput)).toBe(false)
      expect(canInsertHumanInput([node()], BlockEnum.HumanInput)).toBe(false)
    },
  )

  it('rejects mixed-version batches while allowing legacy-only batches in the compatibility workflow', () => {
    const legacy = {
      data: { ...data(), inputs: [createDefaultFormInputByType(InputVarType.select, 'decision')] },
    }
    expect(canInsertHumanInputNodes([legacy], [node()])).toBe(true)
    expect(canInsertHumanInputNodes([legacy], [node('2')])).toBe(false)
    expect(canInsertHumanInputNodes([], [node(), node('2')])).toBe(false)
    expect(
      canInsertHumanInputNodes([], [node(), { data: data(undefined, BlockEnum.HumanInputV2) }]),
    ).toBe(false)
    expect(canInsertHumanInputNodes([node('2')], [node()])).toBe(false)
    expect(canInsertHumanInputNodes([legacy], [node('3')])).toBe(false)
    expect(getHumanInputCreationPolicy([legacy], false).canAddLegacyHumanInput).toBe(false)
  })

  it('keeps backend-supported historical text_input fields on the migration path', () => {
    const legacy = {
      data: { ...data(), inputs: [{ type: 'text_input', output_variable_name: 'note' }] },
    }
    expect(getHumanInputCreationPolicy([legacy], true).canAddLegacyHumanInput).toBe(false)
    expect(canInsertHumanInput([legacy], BlockEnum.HumanInput)).toBe(false)
  })
})
