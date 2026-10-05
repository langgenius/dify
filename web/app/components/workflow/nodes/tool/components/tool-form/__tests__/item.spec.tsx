import type { CredentialFormSchema } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { VarKindType } from '@/app/components/workflow/nodes/_base/types'
import { Type } from '@/app/components/workflow/nodes/llm/types'
import { TriggerFormItem } from '@/app/components/workflow/nodes/trigger-plugin/components/trigger-form/item'
import { ToolFormItem } from '../item'

beforeEach(() => {
  const paths = new Set([
    '/console/api/spec/schema-definitions',
    '/console/api/workspaces/current/tools/builtin',
    '/console/api/workspaces/current/tools/api',
    '/console/api/workspaces/current/tools/workflow',
    '/console/api/workspaces/current/tools/mcp',
  ])
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (paths.has(url.pathname)) return Response.json([])
    throw new Error(`Unexpected request: ${url}`)
  })
})

const createSchema = (overrides: Partial<CredentialFormSchema> = {}): CredentialFormSchema => ({
  name: 'config',
  variable: 'config',
  label: { en_US: 'Config', zh_Hans: 'Config' },
  type: FormTypeEnum.object,
  required: true,
  show_on: [],
  input_schema: { type: Type.object, properties: { city: { type: Type.string } } },
  ...overrides,
})

const consumers = [
  ['tool', ToolFormItem],
  ['trigger', TriggerFormItem],
] as const

describe.each(consumers)('%s parameter schema entry', (_name, Item) => {
  it.each([FormTypeEnum.object, FormTypeEnum.array])(
    'inspects %s parameters through the real dialog without changing their value',
    async (type) => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      renderWorkflowFlowComponent(
        <Item
          readOnly={false}
          nodeId="node-1"
          schema={createSchema({
            type,
            input_schema:
              type === FormTypeEnum.array
                ? {
                    type: Type.array,
                    items: { type: Type.object, properties: { city: { type: Type.string } } },
                  }
                : { type: Type.object, properties: { city: { type: Type.string } } },
          })}
          value={{ config: { type: VarKindType.constant, value: '{}' } }}
          onChange={onChange}
        />,
        { nodes: [], edges: [], hooksStoreProps: {} },
      )
      const editor = screen.getByTestId('monaco-editor')
      const trigger = screen.getByRole('button', { name: /^JSON Schema:/ })
      await user.click(trigger)
      const dialog = screen.getByRole('dialog', {
        name: 'workflowAgent.nodes.agent.parameterSchema',
      })
      expect(within(dialog).getByText('config')).toBeInTheDocument()
      expect(within(dialog).getByText('city')).toBeInTheDocument()
      expect(editor).toBeInTheDocument()
      expect(editor).toHaveValue('{}')
      await user.click(within(dialog).getByRole('button', { name: 'common.operation.close' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(trigger).toHaveFocus()
      expect(editor).toHaveValue('{}')
      expect(onChange).not.toHaveBeenCalled()
    },
  )

  it.each([undefined, null])(
    'keeps an unavailable schema entry disabled for %s',
    async (input_schema) => {
      const user = userEvent.setup()
      renderWorkflowFlowComponent(
        <Item
          readOnly={false}
          nodeId="node-1"
          schema={createSchema({ input_schema })}
          value={{}}
          onChange={vi.fn()}
        />,
        { nodes: [], edges: [], hooksStoreProps: {} },
      )
      const trigger = screen.getByRole('button', { name: /^JSON Schema:/ })
      expect(trigger).toBeDisabled()
      await user.click(trigger)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    },
  )

  it('keeps schema inspection available when the parameter is read-only', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderWorkflowFlowComponent(
      <Item
        readOnly
        nodeId="node-1"
        schema={createSchema()}
        value={{ config: { type: VarKindType.constant, value: '{}' } }}
        onChange={onChange}
      />,
      { nodes: [], edges: [], hooksStoreProps: {} },
    )
    await user.click(screen.getByRole('button', { name: /^JSON Schema:/ }))
    expect(
      screen.getByRole('dialog', { name: 'workflowAgent.nodes.agent.parameterSchema' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /addField/i })).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not offer schema inspection for scalar parameters', () => {
    renderWorkflowFlowComponent(
      <Item
        readOnly
        nodeId="node-1"
        schema={createSchema({ type: FormTypeEnum.textNumber })}
        value={{ config: { type: VarKindType.constant, value: 7 } }}
        onChange={vi.fn()}
      />,
      { nodes: [], edges: [], hooksStoreProps: {} },
    )
    expect(screen.queryByRole('button', { name: /^JSON Schema:/ })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Config' })).toHaveValue('7')
  })
})

it('keeps tool parameter descriptions linked to external documentation', () => {
  renderWorkflowFlowComponent(
    <ToolFormItem
      readOnly
      nodeId="node-1"
      schema={createSchema({
        type: FormTypeEnum.textNumber,
        tooltip: { en_US: 'Visit https://docs.dify.ai/tools for docs', zh_Hans: '' },
      })}
      value={{}}
      onChange={vi.fn()}
    />,
    { nodes: [], edges: [], hooksStoreProps: {} },
  )
  const link = screen.getByRole('link', { name: 'https://docs.dify.ai/tools' })
  expect(link).toHaveAttribute('href', 'https://docs.dify.ai/tools')
  expect(link).toHaveAttribute('target', '_blank')
  expect(link).toHaveAttribute('rel', 'noopener noreferrer')
})
