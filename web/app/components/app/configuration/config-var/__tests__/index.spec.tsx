import type { IConfigVarProps } from '../index'
import type { ExternalDataTool } from '@/models/common'
import type { PromptVariable } from '@/models/debug'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { toast } from '@/app/components/app/configuration/toast'
import DebugConfigurationContext from '@/context/debug-configuration'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { consoleQuery } from '@/service/console'
import { renderWithConfigurationModals } from '@/test/configuration-modals'
import { createConsoleQueryClient } from '@/test/console/query-data'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { createDebugConfigurationFixture } from '@/test/fixtures/debug-configuration'
import ConfigVar, { ADD_EXTERNAL_DATA_TOOL } from '../index'

vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({}),
}))

const toastErrorSpy = vi.spyOn(toast, 'error').mockReturnValue('toast-error')
const variable = (key: string, overrides: Partial<PromptVariable> = {}): PromptVariable => ({
  key,
  name: `Label for ${key}`,
  type: 'string',
  required: false,
  ...overrides,
})
const apiVariable = variable('api_var', {
  name: 'API Var',
  type: 'api',
  config: { api_based_extension_id: 'extension-1' },
})

function ExternalToolEventSource() {
  const { eventEmitter } = useEventEmitterContextContext()
  return (
    <button
      onClick={() =>
        eventEmitter?.emit({
          type: ADD_EXTERNAL_DATA_TOOL,
          payload: {
            variable: 'api_var',
            label: 'API Var',
            enabled: true,
            type: 'api',
            config: { api_based_extension_id: 'extension-1' },
          } satisfies ExternalDataTool,
        })
      }
    >
      Install external data tool
    </button>
  )
}

const renderConfigVar = (
  { promptVariables = [], ...props }: Partial<IConfigVarProps> = {},
  debugOverrides: Parameters<typeof createDebugConfigurationFixture>[0] = {},
) => {
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(
    consoleQuery.codeBasedExtension.get.queryKey({
      input: { query: { module: 'external_data_tool' } },
    }),
    { module: 'external_data_tool', data: [] },
  )
  queryClient.setQueryData(consoleQuery.apiBasedExtension.get.queryKey(), [
    {
      id: 'extension-1',
      name: 'Search API',
      api_endpoint: 'https://example.com/search',
      api_key: 'secret',
    },
  ])
  const context = createDebugConfigurationFixture(debugOverrides)
  function ControlledVariables() {
    const [variables, setVariables] = useState(promptVariables)
    return (
      <DebugConfigurationContext.Provider value={context}>
        <ExternalToolEventSource />
        <ConfigVar {...props} promptVariables={variables} onPromptVariablesChange={setVariables} />
      </DebugConfigurationContext.Provider>
    )
  }
  return renderWithConfigurationModals(<ControlledVariables />, { queryClient })
}
const save = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'common.operation.save' }),
  )
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
}

it('reorders configured variables through keyboard sorting', async () => {
  const user = userEvent.setup()
  renderConfigVar({ promptVariables: [variable('first'), variable('second')] })
  const handle = screen.getAllByRole('button', { name: /sort.handle/ })[0]!
  handle.focus()
  await user.keyboard('{Enter}{ArrowDown}')
  expect(handle).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(screen.getAllByText(/^(first|second)$/).map((item) => item.textContent)).toEqual([
    'second',
    'first',
  ])
})

it('does not expose sorting or editing in readonly mode', () => {
  renderConfigVar({ readonly: true, promptVariables: [variable('first'), variable('second')] })
  expect(screen.queryByRole('button', { name: /sort.handle/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'common.operation.edit' })).not.toBeInTheDocument()
})

it('adds a text variable from the empty state and saves its configuration', async () => {
  const user = userEvent.setup()
  renderConfigVar()
  expect(screen.getByText('appDebug.notSetVar:{"input":"{{input}}"}')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'common.operation.add' }))
  await user.click(await screen.findByText('appDebug.variableConfig.string'))
  await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
  const dialog = screen.getByRole('dialog')
  await user.type(
    within(dialog).getByRole('textbox', { name: 'appDebug.variableConfig.varName' }),
    'topic',
  )
  await user.type(
    within(dialog).getByRole('textbox', { name: 'appDebug.variableConfig.labelName' }),
    'Topic',
  )
  await save(user)
  expect(screen.getByText('topic')).toBeInTheDocument()
})

it('removes the provisional API variable on cancel and preserves existing variables', async () => {
  const user = userEvent.setup()
  renderConfigVar({ promptVariables: [variable('existing')] })
  await user.click(screen.getByRole('button', { name: 'common.operation.add' }))
  await user.click(await screen.findByText('appDebug.variableConfig.apiBasedVar'))
  const dialog = await screen.findByRole('dialog')
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByText('existing')).toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: 'common.operation.edit' })).toHaveLength(1)
})

it('saves a basic variable label and restores it when editing again', async () => {
  const user = userEvent.setup()
  renderConfigVar({ promptVariables: [variable('name', { name: 'Name' })] })
  await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
  const label = screen.getByRole('textbox', { name: 'appDebug.variableConfig.labelName' })
  await user.clear(label)
  await user.type(label, 'Updated Name')
  await save(user)
  await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
  expect(screen.getByRole('textbox', { name: 'appDebug.variableConfig.labelName' })).toHaveValue(
    'Updated Name',
  )
})

it.each([
  ['appDebug.variableConfig.varName', 'second'],
  ['appDebug.variableConfig.labelName', 'Second'],
])('rejects a duplicate %s without replacing either variable', async (field, duplicate) => {
  const user = userEvent.setup()
  renderConfigVar({
    promptVariables: [variable('first', { name: 'First' }), variable('second', { name: 'Second' })],
  })
  await user.click(screen.getAllByRole('button', { name: 'common.operation.edit' })[0]!)
  const input = screen.getByRole('textbox', { name: field })
  await user.clear(input)
  await user.type(input, duplicate)
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(toastErrorSpy).toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getAllByText(/^(first|second)$/).map((item) => item.textContent)).toEqual([
    'first',
    'second',
  ])
})

it.each([false, true])('removes a variable with context confirmation=%s', async (isContext) => {
  const user = userEvent.setup()
  renderConfigVar(
    { promptVariables: [variable('context', { is_context_var: isContext })] },
    {
      mode: 'completion',
      dataSets: [createDatasetFixture()],
    },
  )
  await user.click(screen.getByRole('button', { name: 'common.operation.delete' }))
  if (isContext) {
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  }
  expect(screen.queryByText('context', { exact: true })).not.toBeInTheDocument()
  expect(screen.getByText('appDebug.notSetVar:{"input":"{{input}}"}')).toBeInTheDocument()
})

it('appends external tools received through the real event subscription', async () => {
  const user = userEvent.setup()
  renderConfigVar()
  await user.click(screen.getByRole('button', { name: 'Install external data tool' }))
  expect(screen.getByText('api_var')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
  const dialog = await screen.findByRole('dialog')
  expect(
    within(dialog).getByPlaceholderText('appDebug.feature.tools.modal.name.placeholder'),
  ).toHaveValue('API Var')
})

it('edits an API variable through its real modal and retains the selected API extension', async () => {
  const user = userEvent.setup()
  renderConfigVar({ promptVariables: [apiVariable] })
  await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
  const dialog = await screen.findByRole('dialog')
  const key = within(dialog).getByPlaceholderText(
    'appDebug.feature.tools.modal.variableName.placeholder',
  )
  await user.clear(key)
  await user.type(key, 'next_api_var')
  const label = within(dialog).getByPlaceholderText('appDebug.feature.tools.modal.name.placeholder')
  await user.clear(label)
  await user.type(label, 'Next API Var')
  await save(user)
  expect(screen.queryByText('api_var', { exact: true })).not.toBeInTheDocument()
  expect(screen.getByText('next_api_var')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
  const reopened = await screen.findByRole('dialog')
  expect(
    within(reopened).getByPlaceholderText('appDebug.feature.tools.modal.name.placeholder'),
  ).toHaveValue('Next API Var')
  expect(within(reopened).getByRole('button', { name: /Search API/ })).toBeInTheDocument()
})

it('keeps the API modal open when its variable name duplicates an existing variable', async () => {
  const user = userEvent.setup()
  renderConfigVar({ promptVariables: [apiVariable, variable('existing_var')] })
  await user.click(screen.getAllByRole('button', { name: 'common.operation.edit' })[0]!)
  const dialog = await screen.findByRole('dialog')
  const key = within(dialog).getByPlaceholderText(
    'appDebug.feature.tools.modal.variableName.placeholder',
  )
  await user.clear(key)
  await user.type(key, 'existing_var')
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))
  expect(toastErrorSpy).toHaveBeenCalledWith(
    expect.stringContaining('varKeyError.keyAlreadyExists'),
  )
  expect(dialog).toBeInTheDocument()
  await user.click(within(dialog).getByRole('button', { name: 'common.operation.cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByText('api_var')).toBeInTheDocument()
  expect(screen.getByText('existing_var')).toBeInTheDocument()
})
