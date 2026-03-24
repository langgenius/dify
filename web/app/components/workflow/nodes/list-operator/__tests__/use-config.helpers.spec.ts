import type { ListFilterNodeType } from '../types'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { OrderBy } from '../types'
import {
  buildFilterCondition,
  canFilterVariable,
  getItemVarType,
  getItemVarTypeShowName,
  supportsSubVariable,
  updateExtractEnabled,
  updateExtractSerial,
  updateFilterCondition,
  updateFilterEnabled,
  updateLimit,
  updateListFilterVariable,
  updateOrderByEnabled,
  updateOrderByKey,
  updateOrderByType,
} from '../use-config.helpers'

const createInputs = (): ListFilterNodeType => ({
  title: 'List Filter',
  desc: '',
  type: BlockEnum.ListFilter,
  variable: ['node', 'list'],
  var_type: VarType.arrayString,
  item_var_type: VarType.string,
  filter_by: {
    enabled: false,
    conditions: [{ key: '', comparison_operator: 'contains', value: '' }],
  },
  extract_by: {
    enabled: false,
    serial: '',
  },
  order_by: {
    enabled: false,
    key: '',
    value: OrderBy.DESC,
  },
  limit: {
    enabled: false,
    size: 20,
  },
} as unknown as ListFilterNodeType)

describe('list operator use-config helpers', () => {
  it('maps item var types, labels and filter support', () => {
    expect(getItemVarType(VarType.arrayNumber)).toBe(VarType.number)
    expect(getItemVarType(VarType.arrayBoolean)).toBe(VarType.boolean)
    expect(getItemVarType(undefined)).toBe(VarType.string)
    expect(getItemVarTypeShowName(undefined, false)).toBe('?')
    expect(getItemVarTypeShowName(VarType.number, true)).toBe('Number')
    expect(supportsSubVariable(VarType.arrayFile)).toBe(true)
    expect(supportsSubVariable(VarType.arrayString)).toBe(false)
    expect(canFilterVariable({ type: VarType.arrayFile } as never)).toBe(true)
    expect(canFilterVariable({ type: VarType.string } as never)).toBe(false)
  })

  it('builds default conditions and updates selected variable metadata', () => {
    expect(buildFilterCondition({
      itemVarType: VarType.boolean,
      isFileArray: false,
    })).toEqual(expect.objectContaining({
      key: '',
      value: false,
    }))

    expect(buildFilterCondition({
      itemVarType: VarType.string,
      isFileArray: true,
    })).toEqual(expect.objectContaining({
      key: 'name',
      value: '',
    }))

    const nextInputs = updateListFilterVariable({
      inputs: {
        ...createInputs(),
        order_by: { enabled: true, key: '', value: OrderBy.DESC },
      },
      variable: ['node', 'files'],
      varType: VarType.arrayFile,
      itemVarType: VarType.file,
    })
    expect(nextInputs.var_type).toBe(VarType.arrayFile)
    expect(nextInputs.filter_by.conditions[0]).toEqual(expect.objectContaining({ key: 'name' }))
    expect(nextInputs.order_by.key).toBe('name')
  })

  it('updates filter, extract, limit and order by sections', () => {
    const condition = { key: 'size', comparison_operator: '>', value: '10' }
    expect(updateFilterEnabled(createInputs(), true).filter_by.enabled).toBe(true)
    expect(updateFilterCondition(createInputs(), condition as ListFilterNodeType['filter_by']['conditions'][number]).filter_by.conditions[0]).toEqual(condition)
    expect(updateLimit(createInputs(), { enabled: true, size: 10 }).limit).toEqual({ enabled: true, size: 10 })
    expect(updateExtractEnabled(createInputs(), true).extract_by).toEqual({ enabled: true, serial: '1' })
    expect(updateExtractSerial(createInputs(), '2').extract_by.serial).toBe('2')

    const orderEnabled = updateOrderByEnabled(createInputs(), true, true)
    expect(orderEnabled.order_by).toEqual(expect.objectContaining({
      enabled: true,
      key: 'name',
      value: OrderBy.ASC,
    }))
    expect(updateOrderByKey(createInputs(), 'created_at').order_by.key).toBe('created_at')
    expect(updateOrderByType(createInputs(), OrderBy.DESC).order_by.value).toBe(OrderBy.DESC)
  })
})
