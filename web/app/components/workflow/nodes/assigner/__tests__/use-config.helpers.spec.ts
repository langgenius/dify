import type { AssignerNodeType } from '../types'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { AssignerNodeInputType, WriteMode } from '../types'
import {
  canAssignToVar,
  canAssignVar,
  ensureAssignerVersion,
  filterVarByType,
  normalizeAssignedVarType,
  updateOperationItems,
} from '../use-config.helpers'

const createInputs = (version: AssignerNodeType['version'] = '1'): AssignerNodeType => ({
  title: 'Assigner',
  desc: '',
  type: BlockEnum.Assigner,
  version,
  items: [
    {
      variable_selector: ['conversation', 'count'],
      input_type: AssignerNodeInputType.variable,
      operation: WriteMode.overwrite,
      value: ['node-1', 'value'],
    },
  ],
})

describe('assigner use-config helpers', () => {
  it('filters vars and selectors by supported targets', () => {
    expect(filterVarByType(VarType.any)({ variable: 'value', type: VarType.string })).toBe(true)
    expect(filterVarByType(VarType.number)({ variable: 'value', type: VarType.any })).toBe(true)
    expect(filterVarByType(VarType.number)({ variable: 'value', type: VarType.string })).toBe(false)
    expect(
      canAssignVar({ variable: 'total', type: VarType.number }, ['conversation', 'total']),
    ).toBe(true)
    expect(canAssignVar({ variable: 'total', type: VarType.number }, ['sys', 'total'])).toBe(false)
  })

  it('normalizes assigned variable types for append and passthrough write modes', () => {
    expect(normalizeAssignedVarType(VarType.arrayString, WriteMode.append)).toBe(VarType.string)
    expect(normalizeAssignedVarType(VarType.arrayNumber, WriteMode.append)).toBe(VarType.number)
    expect(normalizeAssignedVarType(VarType.arrayObject, WriteMode.append)).toBe(VarType.object)
    expect(normalizeAssignedVarType(VarType.number, WriteMode.append)).toBe(VarType.string)
    expect(normalizeAssignedVarType(VarType.number, WriteMode.increment)).toBe(VarType.number)
    expect(normalizeAssignedVarType(VarType.string, WriteMode.clear)).toBe(VarType.string)
  })

  it('validates assignment targets for append, arithmetic and fallback modes', () => {
    expect(
      canAssignToVar(
        { variable: 'value', type: VarType.number },
        VarType.number,
        WriteMode.multiply,
      ),
    ).toBe(true)
    expect(
      canAssignToVar(
        { variable: 'value', type: VarType.string },
        VarType.number,
        WriteMode.multiply,
      ),
    ).toBe(false)
    expect(
      canAssignToVar(
        { variable: 'value', type: VarType.string },
        VarType.arrayString,
        WriteMode.append,
      ),
    ).toBe(true)
    expect(
      canAssignToVar(
        { variable: 'value', type: VarType.number },
        VarType.arrayNumber,
        WriteMode.append,
      ),
    ).toBe(true)
    expect(
      canAssignToVar(
        { variable: 'value', type: VarType.object },
        VarType.arrayObject,
        WriteMode.append,
      ),
    ).toBe(true)
    expect(
      canAssignToVar(
        { variable: 'value', type: VarType.boolean },
        VarType.arrayString,
        WriteMode.append,
      ),
    ).toBe(false)
    expect(
      canAssignToVar({ variable: 'value', type: VarType.string }, VarType.string, WriteMode.set),
    ).toBe(true)
  })

  it('ensures version 2 and replaces operation items immutably', () => {
    const legacyInputs = createInputs('1')
    const nextItems = [
      {
        variable_selector: ['conversation', 'total'],
        input_type: AssignerNodeInputType.constant,
        operation: WriteMode.clear,
        value: '0',
      },
    ]

    expect(ensureAssignerVersion(legacyInputs).version).toBe('2')
    expect(ensureAssignerVersion(createInputs('2')).version).toBe('2')
    expect(updateOperationItems(legacyInputs, nextItems).items).toEqual(nextItems)
    expect(legacyInputs).toEqual(createInputs('1'))
  })

  it('sanitizes variable-selector items restored from collaboration payloads', () => {
    const dirtyItems = [
      {
        variable_selector:
          null as unknown as AssignerNodeType['items'][number]['variable_selector'],
        input_type: AssignerNodeInputType.variable,
        operation: WriteMode.overwrite,
        value: null,
      },
    ]

    expect(updateOperationItems(createInputs('2'), dirtyItems).items).toEqual([
      {
        variable_selector: [],
        input_type: AssignerNodeInputType.variable,
        operation: WriteMode.overwrite,
        value: [],
      },
    ])
  })
})
