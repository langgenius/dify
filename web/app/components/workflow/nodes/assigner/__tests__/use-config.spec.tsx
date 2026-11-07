import type { AssignerNodeOperation, AssignerNodeType } from '../types'
import { act } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import { renderNodeConfig } from '../../__tests__/render-node-config'
import { AssignerNodeInputType, WriteMode } from '../types'
import useConfig from '../use-config'

const createOperation = (
  overrides: Partial<AssignerNodeOperation> = {},
): AssignerNodeOperation => ({
  variable_selector: ['conversation', 'count'],
  input_type: AssignerNodeInputType.variable,
  operation: WriteMode.overwrite,
  value: ['node-2', 'result'],
  ...overrides,
})

const createPayload = (overrides: Partial<AssignerNodeType> = {}): AssignerNodeType => ({
  title: 'Assigner',
  desc: '',
  type: BlockEnum.Assigner,
  version: '2',
  items: [createOperation()],
  ...overrides,
})

it('persists operation edits as version 2 and retains earlier edits through subsequent updates', () => {
  const { result } = renderNodeConfig(useConfig, createPayload())
  const appended = createOperation({ operation: WriteMode.append })
  act(() => result.current.config.handleOperationListChanges([appended]))
  expect(result.current.flow.getNode('node')?.data).toMatchObject({
    version: '2',
    items: [appended],
  })
  const next = createOperation({
    variable_selector: ['conversation', 'name'],
    input_type: AssignerNodeInputType.constant,
    value: 'Updated name',
  })
  act(() =>
    result.current.config.handleOperationListChanges([...result.current.config.inputs.items, next]),
  )
  expect(result.current.flow.getNode('node')?.data.items).toEqual([appended, next])
})

it('normalizes collaboration-restored null selectors and persists repaired assignments on the next edit', () => {
  const payload = createPayload({
    items: [
      createOperation({
        variable_selector: null as unknown as AssignerNodeOperation['variable_selector'],
        value: null,
      }),
    ],
  })
  const { result } = renderNodeConfig(useConfig, payload)
  const repaired = createOperation({ variable_selector: [], value: [] })
  expect(result.current.config.inputs.items).toEqual([repaired])
  act(() => result.current.config.handleOperationListChanges(result.current.config.inputs.items))
  expect(result.current.flow.getNode('node')?.data.items).toEqual([repaired])
})
