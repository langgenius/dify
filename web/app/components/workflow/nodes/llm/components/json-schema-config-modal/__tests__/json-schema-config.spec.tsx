import type { StructuredOutput } from '../../../types'
import { QueryClient } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { useState } from 'react'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { consoleQuery } from '@/service/console'
import { commonQueryKeys } from '@/service/use-common'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { createSystemFeaturesFixture } from '@/test/console/system-features'
import { Type } from '../../../types'
import { StructureOutput } from '../../structure-output'

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
        aria-label="JSON schema editor"
        value={value}
        readOnly={options?.readOnly}
        onChange={(event) => onChange?.(event.target.value)}
      />
    )
  }
  return {
    Editor,
    default: Editor,
    DiffEditor: Editor,
    useMonaco: () => null,
    loader: { config: vi.fn() },
  }
})
const emptySchema = {
  type: Type.object,
  properties: {},
  required: [],
  additionalProperties: false as const,
}
const namedSchema = {
  ...emptySchema,
  properties: { name: { type: Type.string } },
  required: ['name'],
}
const dialogName = 'workflowModels.nodes.llm.jsonSchema.title'
const saveName = 'common.operation.save'
const generatorName = 'workflowModels.nodes.llm.jsonSchema.generateJsonSchema'
const instructionName = 'workflowModels.nodes.llm.jsonSchema.instruction'
const applyName = 'workflowModels.nodes.llm.jsonSchema.apply'

function renderOutput({ readOnly = false, onChange = vi.fn() } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(
    consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryOptions({
      input: { params: { model_type: ModelTypeEnum.textGeneration } },
    }).queryKey,
    { data: [] },
  )
  client.setQueryData(commonQueryKeys.defaultModel(ModelTypeEnum.textGeneration), { data: null })
  client.setQueryData(
    consoleQuery.systemFeatures.get.queryOptions().queryKey,
    createSystemFeaturesFixture(),
  )
  client.setQueryData(
    consoleQuery.workspaces.current.modelProviders.credits.get.queryOptions().queryKey,
    {
      model_billing_source: 'legacy_message_credits',
      model_billing_migration_status: 'none',
      tokener_bootstrap_status: null,
      pool_type: 'trial',
      quota_limit: 200,
      quota_used: 0,
      remaining_credits: 200,
      is_unlimited: false,
      is_exhausted: false,
      exhausted_at: null,
      next_credit_reset_date: null,
    },
  )
  function Fixture({ readOnly }: { readOnly: boolean }) {
    const [value, setValue] = useState<StructuredOutput>({ schema: emptySchema })
    return (
      <StructureOutput
        value={value}
        onChange={(next) => {
          onChange(next)
          setValue(next)
        }}
        readOnly={readOnly}
      />
    )
  }
  const view = render(
    <NuqsTestingAdapter>
      <QueryClientTestProvider queryClient={client}>
        <Fixture readOnly={readOnly} />
      </QueryClientTestProvider>
    </NuqsTestingAdapter>,
  )
  return {
    onChange,
    setReadOnly(next: boolean) {
      view.rerender(
        <NuqsTestingAdapter>
          <QueryClientTestProvider queryClient={client}>
            <Fixture readOnly={next} />
          </QueryClientTestProvider>
        </NuqsTestingAdapter>,
      )
    },
  }
}
async function openEditor(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'app.structOutput.configure' }))
  return screen.findByRole('dialog', { name: dialogName })
}
async function editJSON(user: ReturnType<typeof userEvent.setup>, json: string) {
  await user.click(screen.getByRole('tab', { name: 'JSON Schema' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'JSON schema editor' }), {
    target: { value: json },
  })
}
async function closeEditor(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: dialogName })).not.toBeInTheDocument(),
  )
}
async function generate(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: generatorName }))
  await user.type(await screen.findByRole('textbox', { name: instructionName }), 'Generate a name')
  await user.click(
    screen.getByRole('button', {
      name: 'workflowModels.nodes.llm.jsonSchema.generate',
    }),
  )
}
beforeEach(() => vi.restoreAllMocks())

describe('StructureOutput schema sessions', () => {
  it('moves tab focus without activating a different editor', async () => {
    const user = userEvent.setup()
    renderOutput()
    await openEditor(user)
    const visualTab = screen.getByRole('tab', { name: 'Visual Editor' })
    visualTab.focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'JSON Schema' })).toHaveFocus()
    expect(visualTab).toHaveAttribute('aria-selected', 'true')
  })
  it('keeps invalid JSON open and resets draft, errors and tab after cancel', async () => {
    const user = userEvent.setup()
    const { onChange } = renderOutput()
    await openEditor(user)
    await editJSON(user, 'invalid json')
    await user.click(screen.getByRole('tab', { name: 'Visual Editor' }))
    expect(screen.getByRole('tab', { name: 'JSON Schema' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await user.click(screen.getByRole('button', { name: saveName }))
    expect(screen.getByRole('dialog', { name: dialogName })).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
    await closeEditor(user)
    await openEditor(user)
    expect(screen.getByRole('tab', { name: 'Visual Editor' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await user.click(screen.getByRole('tab', { name: 'JSON Schema' }))
    expect(screen.getByRole('textbox', { name: 'JSON schema editor' })).toHaveValue(
      JSON.stringify(emptySchema, null, 2),
    )
    await user.click(screen.getByRole('button', { name: saveName }))
    expect(onChange).toHaveBeenCalledWith({ schema: emptySchema })
  })
  it('commits valid JSON once and reopens from the saved value', async () => {
    const user = userEvent.setup()
    const { onChange } = renderOutput()
    await openEditor(user)
    await editJSON(user, JSON.stringify(namedSchema))
    await user.click(screen.getByRole('button', { name: saveName }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: dialogName })).not.toBeInTheDocument(),
    )
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ schema: namedSchema })
    await openEditor(user)
    await user.click(screen.getByRole('tab', { name: 'JSON Schema' }))
    expect(screen.getByRole('textbox', { name: 'JSON schema editor' })).toHaveValue(
      JSON.stringify(namedSchema, null, 2),
    )
  })
  it.each([
    ['invalid root', JSON.stringify({ type: 'string' })],
    [
      'invalid property type',
      JSON.stringify({ ...emptySchema, properties: { name: { type: 'invalid' } } }),
    ],
    [
      'excessive depth',
      JSON.stringify(
        Array.from({ length: 15 }).reduce<object>(
          (schema) => ({ ...emptySchema, properties: { nested: schema } }),
          emptySchema,
        ),
      ),
    ],
  ])('refuses saving %s', async (_label, json) => {
    const user = userEvent.setup()
    const { onChange } = renderOutput()
    await openEditor(user)
    await editJSON(user, json)
    await user.click(screen.getByRole('button', { name: saveName }))
    expect(screen.getByRole('dialog', { name: dialogName })).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })
  it('refuses unfinished visual edits and creates a clean store after closing', async () => {
    const user = userEvent.setup()
    const { onChange } = renderOutput()
    await openEditor(user)
    await user.click(
      screen.getByRole('button', { name: 'workflowModels.nodes.llm.jsonSchema.addField' }),
    )
    await user.click(screen.getByRole('button', { name: saveName }))
    expect(onChange).not.toHaveBeenCalled()
    await closeEditor(user)
    await openEditor(user)
    await user.click(screen.getByRole('button', { name: saveName }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ schema: emptySchema })
  })
  it('gates initial read-only permissions and terminates an active draft when permission changes', async () => {
    const user = userEvent.setup()
    const { onChange, setReadOnly } = renderOutput({ readOnly: true })
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('app.structOutput.notConfiguredTip')).toBeInTheDocument()
    setReadOnly(false)
    await openEditor(user)
    await editJSON(user, JSON.stringify(namedSchema))
    setReadOnly(true)
    expect(screen.queryByRole('dialog', { name: dialogName })).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
    setReadOnly(false)
    await openEditor(user)
    await user.click(screen.getByRole('tab', { name: 'JSON Schema' }))
    expect(screen.getByRole('textbox', { name: 'JSON schema editor' })).toHaveValue(
      JSON.stringify(emptySchema, null, 2),
    )
  })
  it('applies generated schema only to the draft and discards it on main cancel', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ output: JSON.stringify(namedSchema) }),
    )
    const user = userEvent.setup()
    const { onChange } = renderOutput()
    await openEditor(user)
    await generate(user)
    await user.click(await screen.findByRole('button', { name: applyName }))
    await user.click(screen.getByRole('tab', { name: 'JSON Schema' }))
    expect(screen.getByRole('textbox', { name: 'JSON schema editor' })).toHaveValue(
      JSON.stringify(namedSchema, null, 2),
    )
    expect(onChange).not.toHaveBeenCalled()
    await closeEditor(user)
    await openEditor(user)
    await user.click(screen.getByRole('tab', { name: 'JSON Schema' }))
    expect(screen.getByRole('textbox', { name: 'JSON schema editor' })).toHaveValue(
      JSON.stringify(emptySchema, null, 2),
    )
  })
  it('does not let a late generation result populate a newly opened session', async () => {
    let resolve!: (value: Response) => void
    vi.spyOn(globalThis, 'fetch').mockReturnValue(
      new Promise((done) => {
        resolve = done
      }),
    )
    const user = userEvent.setup()
    const { onChange } = renderOutput()
    await openEditor(user)
    await generate(user)
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: dialogName })).not.toBeInTheDocument(),
    )
    await openEditor(user)
    await act(async () => resolve(Response.json({ output: JSON.stringify(namedSchema) })))
    await user.click(screen.getByRole('button', { name: generatorName }))
    expect(await screen.findByRole('textbox', { name: instructionName })).toHaveValue('')
    expect(screen.queryByRole('button', { name: applyName })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: generatorName }))
    await user.click(screen.getByRole('tab', { name: 'JSON Schema' }))
    expect(screen.getByRole('textbox', { name: 'JSON schema editor' })).toHaveValue(
      JSON.stringify(emptySchema, null, 2),
    )
    expect(onChange).not.toHaveBeenCalled()
  })
})
