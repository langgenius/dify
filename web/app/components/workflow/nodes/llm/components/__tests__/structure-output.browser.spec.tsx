import type { StructuredOutput } from '../../types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { render } from 'vitest-browser-react'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { consoleQuery } from '@/service/console'
import { commonQueryKeys } from '@/service/use-common'
import { Type } from '../../types'
import { StructureOutput } from '../structure-output'

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

function StructuredOutputFixture() {
  const [value, setValue] = useState<StructuredOutput>({ schema: emptySchema })
  return <StructureOutput value={value} onChange={setValue} readOnly={false} />
}

function renderOutput() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  queryClient.setQueryData(
    consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryOptions({
      input: { params: { model_type: ModelTypeEnum.textGeneration } },
    }).queryKey,
    { data: [] },
  )
  queryClient.setQueryData(commonQueryKeys.defaultModel(ModelTypeEnum.textGeneration), {
    data: null,
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <StructuredOutputFixture />
    </QueryClientProvider>,
  )
}

beforeEach(() => vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false))
afterEach(() => vi.unstubAllGlobals())

it('returns focus to Configure when saving a schema removes the empty-state trigger', async () => {
  const screen = await renderOutput()
  const emptyTrigger = screen.getByRole('button', { name: 'app.structOutput.notConfiguredTip' })
  const configure = screen.getByRole('button', { name: 'app.structOutput.configure' })
  const dialog = screen.getByRole('dialog', { name: 'workflowModels.nodes.llm.jsonSchema.title' })
  await emptyTrigger.click()
  await screen.getByRole('tab', { name: 'JSON Schema' }).click()
  await screen
    .getByRole('textbox', { name: 'JSON schema editor' })
    .fill(JSON.stringify(namedSchema))
  await screen.getByRole('button', { name: 'common.operation.save' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(emptyTrigger).not.toBeInTheDocument()
  await expect.element(configure).toHaveFocus()
})
