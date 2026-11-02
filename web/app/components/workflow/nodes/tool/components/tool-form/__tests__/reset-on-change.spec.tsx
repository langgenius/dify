import type { FormInputSchema } from '@/app/components/workflow/nodes/_base/components/form-input-item.helpers'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { VarKindType } from '@/app/components/workflow/nodes/_base/types'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import ToolForm from '../index'

it('resets a dependent parameter in the same user change as its source', async () => {
  const { queryClient } = createConsoleQueryWrapper()
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  const schema: FormInputSchema[] = [
    {
      name: 'source',
      variable: 'source',
      label: { en_US: 'Source', zh_Hans: 'Source' },
      type: FormTypeEnum.checkbox,
      _type: FormTypeEnum.boolean,
      required: false,
      show_on: [],
      reset_on_change: [],
    },
    {
      name: 'dependent',
      variable: 'dependent',
      label: { en_US: 'Dependent', zh_Hans: 'Dependent' },
      type: FormTypeEnum.textNumber,
      required: false,
      show_on: [],
      default: '7',
      reset_on_change: ['source'],
    },
  ]
  const onChange = vi.fn()
  renderWorkflowFlowComponent(
    <ToolForm
      staticSchema
      readOnly={false}
      nodeId="node-1"
      schema={schema}
      value={{
        source: { type: VarKindType.constant, value: false },
        dependent: { type: VarKindType.constant, value: 9 },
      }}
      onChange={onChange}
    />,
    { queryClient, nodes: [], edges: [] },
  )
  await userEvent.setup().click(screen.getByRole('button', { name: 'True' }))
  expect(onChange).toHaveBeenCalledExactlyOnceWith({
    source: { type: VarKindType.constant, value: true },
    dependent: { type: VarKindType.constant, value: 7 },
  })
})
