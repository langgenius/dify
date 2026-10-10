import type { ReasoningConfigValue } from '../reasoning-config-form'
import type { ToolFormSchema } from '@/app/components/tools/utils/to-form-schema'
import type { Field } from '@/app/components/workflow/nodes/llm/types'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { WorkflowContextProvider } from '@/app/components/workflow/context'
import { VarKindType } from '@/app/components/workflow/nodes/_base/types'
import { Type } from '@/app/components/workflow/nodes/llm/types'
import { ReasoningConfigForm } from '../reasoning-config-form'

vi.mock('@monaco-editor/react', () => {
  function Editor({
    value,
    onChange,
    options,
  }: {
    value?: string
    onChange?: (value: string) => void
    options?: { readOnly?: boolean }
  }) {
    return (
      <textarea
        aria-label="JSON parameter editor"
        value={value}
        readOnly={options?.readOnly}
        onChange={(event) => onChange?.(event.target.value)}
      />
    )
  }
  return {
    default: Editor,
    Editor,
    DiffEditor: Editor,
    useMonaco: () => null,
    loader: { config: vi.fn() },
  }
})

const profileSchema: Field = {
  type: Type.object,
  properties: { person_name: { type: Type.string, description: 'The profile name' } },
  required: ['person_name'],
}
const rowsSchema: Field = {
  type: Type.array,
  items: {
    type: Type.object,
    properties: { row_count: { type: Type.number } },
    required: ['row_count'],
  },
}

function createParameter(
  variable: string,
  label: string,
  type: FormTypeEnum,
  schema?: Field,
): ToolFormSchema {
  return {
    name: variable,
    variable,
    label: { en_US: label, zh_Hans: label },
    type,
    _type: type,
    form: 'form',
    required: false,
    show_on: [],
    input_schema: schema,
  }
}

function ReasoningFixture({
  onChange,
  profile = profileSchema,
}: {
  onChange: (value: ReasoningConfigValue) => void
  profile?: Field
}) {
  const [value, setValue] = useState<ReasoningConfigValue>({
    profile: { auto: 0, value: { type: VarKindType.constant, value: '{}' } },
    rows: { auto: 0, value: { type: VarKindType.constant, value: '[]' } },
    amount: { auto: 0, value: { type: VarKindType.constant, value: 3 } },
  })
  return (
    <WorkflowContextProvider>
      <Popover>
        <PopoverTrigger>Configure tool</PopoverTrigger>
        <PopoverContent aria-label="Tool configuration" className="w-90">
          <ReasoningConfigForm
            nodeId="agent-1"
            value={value}
            onChange={(next) => {
              setValue(next)
              onChange(next)
            }}
            schemas={[
              createParameter('profile', 'Profile', FormTypeEnum.object, profile),
              createParameter('rows', 'Rows', FormTypeEnum.array, rowsSchema),
              createParameter('amount', 'Amount', FormTypeEnum.textNumber),
            ]}
            nodeOutputVars={[]}
            availableNodes={[]}
          />
        </PopoverContent>
      </Popover>
    </WorkflowContextProvider>
  )
}

beforeEach(async () => {
  await page.viewport(1280, 900)
})

it('preserves real reasoning fields in their Popover while each schema closes back to its own entry', async () => {
  const onChange = vi.fn()
  const screen = await render(<ReasoningFixture onChange={onChange} />)
  await screen.getByRole('button', { name: 'Configure tool' }).click()
  const parent = screen.getByRole('dialog', { name: 'Tool configuration' })
  const editor = parent.getByRole('textbox', { name: 'JSON parameter editor' }).nth(0)
  const amount = parent.getByRole('spinbutton', { name: 'Amount' })
  await editor.fill('{"person_name":"Draft name"}')
  await amount.fill('7')
  const originalEditor = editor.element()
  const originalAmount = amount.element()
  onChange.mockClear()

  const profileEntry = parent.getByRole('button', {
    name: 'workflowAgent.nodes.agent.clickToViewParameterSchema: Profile',
  })
  await profileEntry.click()
  const dialog = screen.getByRole('dialog', { name: 'workflowAgent.nodes.agent.parameterSchema' })
  await expect.element(dialog.getByText('Profile')).toBeVisible()
  await expect.element(dialog.getByText('person_name')).toBeVisible()
  await expect.element(dialog.getByText('row_count')).not.toBeInTheDocument()
  expect(originalEditor.isConnected).toBe(true)
  expect(originalAmount.isConnected).toBe(true)
  await userEvent.hover(dialog.getByText('person_name'))
  await expect.element(dialog.getByRole('textbox')).not.toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(parent).toBeVisible()
  await expect.element(profileEntry).toHaveFocus()
  expect(editor.element()).toBe(originalEditor)
  expect(amount.element()).toBe(originalAmount)
  await expect.element(editor).toHaveValue('{"person_name":"Draft name"}')
  await expect.element(amount).toHaveValue(7)

  const rowsEntry = parent.getByRole('button', {
    name: 'workflowAgent.nodes.agent.clickToViewParameterSchema: Rows',
  })
  await rowsEntry.click()
  await expect.element(dialog.getByText('Rows')).toBeVisible()
  await expect.element(dialog.getByText('row_count')).toBeVisible()
  await expect.element(dialog.getByText('person_name')).not.toBeInTheDocument()
  await dialog.getByRole('button', { name: 'common.operation.close' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(rowsEntry).toHaveFocus()
  await expect.element(parent).toBeVisible()
  expect(onChange).not.toHaveBeenCalled()
  expect(editor.element()).toBe(originalEditor)
  await amount.fill('8')
  expect(onChange).toHaveBeenCalledOnce()
})

it('keeps a long schema scrollable and Close reachable on a small viewport', async () => {
  await page.viewport(414, 640)
  const properties = Object.fromEntries(
    Array.from({ length: 50 }, (_, index) => [`property_${index}`, { type: Type.string }]),
  )
  const screen = await render(
    <ReasoningFixture onChange={vi.fn()} profile={{ type: Type.object, properties }} />,
  )
  await screen.getByRole('button', { name: 'Configure tool' }).click()
  const parent = screen.getByRole('dialog', { name: 'Tool configuration' })
  const entry = parent.getByRole('button', {
    name: 'workflowAgent.nodes.agent.clickToViewParameterSchema: Profile',
  })
  await entry.click()
  const dialog = screen.getByRole('dialog', { name: 'workflowAgent.nodes.agent.parameterSchema' })
  const close = dialog.getByRole('button', { name: 'common.operation.close' })
  const closeBounds = close.element().getBoundingClientRect()
  expect(closeBounds.left).toBeGreaterThanOrEqual(0)
  expect(closeBounds.right).toBeLessThanOrEqual(window.innerWidth)
  expect(closeBounds.top).toBeGreaterThanOrEqual(0)
  expect(closeBounds.bottom).toBeLessThanOrEqual(window.innerHeight)
  await dialog.getByText('property_0').wheel({ delta: { y: 1800 } })
  await expect
    .poll(() => {
      const fieldBounds = dialog.getByText('property_49').element().getBoundingClientRect()
      return fieldBounds.top >= 0 && fieldBounds.bottom <= window.innerHeight
    })
    .toBe(true)
  await close.click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(parent).toBeVisible()
  await expect.element(entry).toHaveFocus()
})
