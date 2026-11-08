import type { Var } from '@/app/components/workflow/types'
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { VarType } from '@/app/components/workflow/types'
import { Method } from '../../types'
import ApiInput from '../api-input'
import InputItem from '../key-value/key-value-edit/input-item'

const { filterVars } = vi.hoisted(() => ({
  filterVars: [] as Array<((variable: Var) => boolean) | undefined>,
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-available-var-list', () => ({
  default: (_nodeId: string, options: { filterVar?: (variable: Var) => boolean }) => {
    filterVars.push(options.filterVar)
    return { availableVars: [], availableNodesWithParent: [] }
  },
}))

vi.mock('@/app/components/workflow/nodes/_base/components/input-support-select-var', () => ({
  default: ({ value }: { value: string }) => <input readOnly value={value} />,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/selector', () => ({
  default: () => <div />,
}))

const variableOfType = (type: VarType) => ({ variable: 'value', type }) as Var

const lastFilter = () => {
  const filter = filterVars[filterVars.length - 1]
  if (!filter) throw new Error('the component did not pass a filterVar to useAvailableVarList')
  return filter
}

const acceptedTypes = (filter: (variable: Var) => boolean) =>
  [VarType.string, VarType.number, VarType.integer, VarType.secret].filter((type) =>
    filter(variableOfType(type)),
  )

describe('HTTP node text variable filters', () => {
  beforeEach(() => {
    filterVars.length = 0
  })

  it('should offer integer variables for the request URL and reject structured types', () => {
    render(
      <ApiInput
        nodeId="http-node"
        readonly={false}
        method={Method.get}
        onMethodChange={() => {}}
        url=""
        onUrlChange={() => {}}
      />,
    )

    const filter = lastFilter()

    expect(acceptedTypes(filter)).toEqual([
      VarType.string,
      VarType.number,
      VarType.integer,
      VarType.secret,
    ])
    expect(filter(variableOfType(VarType.boolean))).toBe(false)
    expect(filter(variableOfType(VarType.object))).toBe(false)
    expect(filter(variableOfType(VarType.arrayString))).toBe(false)
    expect(filter(variableOfType(VarType.file))).toBe(false)
  })

  it('should offer integer variables for header and param values while keeping files out', () => {
    render(<InputItem nodeId="http-node" value="" onChange={() => {}} hasRemove={false} />)

    const filter = lastFilter()

    expect(acceptedTypes(filter)).toEqual([
      VarType.string,
      VarType.number,
      VarType.integer,
      VarType.secret,
    ])
    expect(filter(variableOfType(VarType.file))).toBe(false)
    expect(filter(variableOfType(VarType.arrayFile))).toBe(false)
    expect(filter(variableOfType(VarType.object))).toBe(false)
  })

  it('should keep file values selectable only where the field accepts files', () => {
    render(
      <InputItem nodeId="http-node" value="" onChange={() => {}} hasRemove={false} isSupportFile />,
    )

    const filter = lastFilter()

    expect(acceptedTypes(filter)).toEqual([
      VarType.string,
      VarType.number,
      VarType.integer,
      VarType.secret,
    ])
    expect(filter(variableOfType(VarType.file))).toBe(true)
    expect(filter(variableOfType(VarType.arrayFile))).toBe(true)
    expect(filter(variableOfType(VarType.boolean))).toBe(false)
    expect(filter(variableOfType(VarType.object))).toBe(false)
  })
})
