import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import {
  createEdge,
  createNode,
  createStartNode,
} from '@/app/components/workflow/__tests__/fixtures'
import { BlockEnum, InputVarType, VarType } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { render } from '@/test/console/render'
import { seedToolProviders } from '@/test/console/tool-providers'
import PublishedGraphVariablePicker from '../published-graph-variable-picker'

describe('PublishedGraphVariablePicker', () => {
  it('maps an output from the published workflow graph', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const start = createStartNode({
      id: 'start',
      data: {
        variables: [
          {
            variable: 'question',
            label: 'Question',
            type: InputVarType.textInput,
            required: false,
          },
        ],
      },
    })
    const source = createNode({
      id: 'source',
      data: {
        title: 'Source',
        type: BlockEnum.Code,
        outputs: { answer: { type: VarType.string, children: null } },
      },
    })

    const { queryClient, wrapper } = createConsoleQueryWrapper({
      appDslVersion: '0.6.0',
      systemFeatures: { enable_collaboration_mode: false },
    })
    seedModelProviderQueries(queryClient)
    seedToolProviders(queryClient, {
      builtInTools: [],
      customTools: [],
      workflowTools: [],
      mcpTools: [],
    })
    queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])

    render(
      <PublishedGraphVariablePicker
        resource={{ kind: 'app', appId: 'target-app', mode: 'workflow' }}
        nodes={[start, source]}
        edges={[createEdge({ source: 'start', target: 'source' })]}
        placeholder="Select an output variable"
        value={null}
        onChange={onChange}
      />,
      { wrapper },
    )

    await user.click(screen.getByRole('button', { name: /Select an output variable/ }))
    await user.click(within(await screen.findByRole('dialog')).getByText('answer'))

    expect(onChange).toHaveBeenCalledWith('source.answer')
  })
})
