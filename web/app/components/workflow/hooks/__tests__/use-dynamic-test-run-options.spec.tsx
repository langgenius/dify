import { act } from '@testing-library/react'
import { createNode } from '../../__tests__/fixtures'
import { renderWorkflowHook } from '../../__tests__/workflow-test-env'
import { BlockEnum } from '../../types'
import { useDynamicTestRunOptions } from '../use-dynamic-test-run-options'

vi.mock('@/service/use-triggers', () => ({
  useAllTriggerPlugins: () => ({ data: [{ name: 'plugin-provider', icon: '/plugin-icon.png' }] }),
}))

it('builds input, trigger and run-all options from the real workflow store and responds to changes', () => {
  const nodes = [
    createNode({ id: 'start', data: { type: BlockEnum.Start, title: 'User Input' } }),
    createNode({
      id: 'schedule',
      data: { type: BlockEnum.TriggerSchedule, title: 'Daily Schedule' },
    }),
    createNode({
      id: 'webhook',
      data: { type: BlockEnum.TriggerWebhook, title: 'Webhook Trigger' },
    }),
    createNode({
      id: 'plugin',
      data: {
        type: BlockEnum.TriggerPlugin,
        title: '',
        plugin_name: 'Plugin Trigger',
        provider_id: 'plugin-provider',
      },
    }),
  ]
  const { result, store } = renderWorkflowHook(() => useDynamicTestRunOptions(), {
    initialStoreState: { nodes },
  })
  expect(result.current.userInput).toMatchObject({
    id: 'start',
    type: 'user_input',
    name: 'User Input',
    enabled: true,
  })
  expect(result.current.triggers).toMatchObject([
    { nodeId: 'schedule', type: 'schedule', name: 'Daily Schedule' },
    { nodeId: 'webhook', type: 'webhook', name: 'Webhook Trigger' },
    { nodeId: 'plugin', type: 'plugin', name: 'Plugin Trigger' },
  ])
  expect(result.current.runAll).toMatchObject({
    type: 'all',
    relatedNodeIds: ['schedule', 'webhook', 'plugin'],
  })
  act(() => store.setState({ nodes: [nodes[2]!] }))
  expect(result.current.triggers).toHaveLength(1)
  expect(result.current.userInput).toBeUndefined()
  expect(result.current.runAll).toBeUndefined()
})

it('uses the localized start label and has no options for an empty graph', () => {
  const { result, store } = renderWorkflowHook(() => useDynamicTestRunOptions(), {
    initialStoreState: {
      nodes: [createNode({ id: 'start', data: { type: BlockEnum.Start, title: '' } })],
    },
  })
  expect(result.current.userInput).toMatchObject({ nodeId: 'start', name: 'workflow.blocks.start' })
  expect(result.current.triggers).toEqual([])
  act(() => store.setState({ nodes: [] }))
  expect(result.current).toEqual({ userInput: undefined, triggers: [], runAll: undefined })
})
