import type { AgentStrategyParameter } from '@dify/contracts/api/console/workspaces/types.gen'
import type { AgentNodeType } from '../types'
import { VarKindType } from '@/app/components/workflow/nodes/_base/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { withSelectorKey } from '@/test/i18n-mock'
import nodeDefault from '../default'
import { createStrategy } from './strategy-fixture'

const t = withSelectorKey((key: string) => key, 'workflow')
const check = (parameter: AgentStrategyParameter, value?: unknown) => {
  const payload: AgentNodeType = {
    title: 'Agent',
    desc: '',
    type: BlockEnum.Agent,
    output_schema: null,
    agent_parameters: value === undefined ? {} : { input: { type: VarKindType.constant, value } },
  }
  return nodeDefault.checkValid(payload, t, {
    strategy: createStrategy({ parameters: [parameter] }),
    language: 'en_US',
    isReadyForCheckValid: true,
  })
}

it.each([
  { type: 'number', value: 0 },
  { type: 'boolean', value: false },
] satisfies { type: AgentStrategyParameter['type']; value: unknown }[])(
  'accepts required $type zero values from saved inputs and declaration defaults',
  ({ type, value }) => {
    const parameter: AgentStrategyParameter = {
      name: 'input',
      type,
      label: { en_US: 'Input' },
      required: true,
    }
    expect(check(parameter, value).isValid).toBe(true)
    expect(check({ ...parameter, default: value === false ? false : 0 }).isValid).toBe(true)
  },
)

it.each(['', null])(
  'accepts a cleared input %s with a declaration default, matching runtime initialization',
  (value) => {
    expect(
      check(
        {
          name: 'input',
          type: 'string',
          label: { en_US: 'Input' },
          required: true,
          default: 'Default prompt',
        },
        value,
      ).isValid,
    ).toBe(true)
  },
)

it('rejects an absent required input with a nullable default', () => {
  expect(
    check({
      name: 'input',
      type: 'string',
      label: { en_US: 'Input' },
      required: true,
      default: null,
    }).isValid,
  ).toBe(false)
})
