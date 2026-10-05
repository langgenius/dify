import type { SnippetDetail, SnippetInputField } from '@/models/snippet'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { PipelineInputVarType } from '@/models/pipeline'
import { useSnippetDraftStore } from '../../draft-store'
import { useSnippetInputFieldActions } from '../hooks/use-snippet-input-field-actions'
import { SnippetSidebarContent } from '../snippet-sidebar'

vi.mock('@/app/components/app-sidebar/snippet-info/dropdown', () => ({ default: () => null }))

const snippet: SnippetDetail = {
  id: 'snippet-1',
  name: 'Snippet',
  description: 'Description',
  updatedAt: '2026-03-29 10:00',
  usage: '0',
  tags: [],
}
const initialFields: SnippetInputField[] = [
  {
    type: PipelineInputVarType.textInput,
    label: 'Query',
    variable: 'query',
    required: true,
    max_length: 48,
  },
]
const changes = vi.fn()

function SidebarOwner({ readonly = false }: { readonly?: boolean }) {
  const [fields, setFields] = useState(initialFields)
  return (
    <SnippetSidebarContent
      snippet={snippet}
      fields={fields}
      readonly={readonly}
      onFieldsChange={(next) => {
        changes(next)
        setFields(next)
      }}
    />
  )
}

function DraftSidebarOwner() {
  const { fields, handleFieldsChange } = useSnippetInputFieldActions({ snippetId: snippet.id })
  return (
    <SnippetSidebarContent
      snippet={snippet}
      fields={fields}
      readonly={false}
      onFieldsChange={handleFieldsChange}
    />
  )
}

let resolveSync: ((response: Response) => void) | undefined
let postedBody: { input_fields: SnippetInputField[] } | undefined
beforeEach(() => {
  changes.mockClear()
  postedBody = undefined
  resolveSync = undefined
  useSnippetDraftStore.getState().reset()
  useSnippetDraftStore.getState().setInputFields(initialFields)
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init)
    if (request.url.endsWith('/snippets/snippet-1/workflows/draft') && request.method === 'POST') {
      postedBody = await request.json()
      return new Promise<Response>((resolve) => {
        resolveSync = resolve
      })
    }
    if (request.url.includes('/default-model?')) return Response.json({ data: null })
    if (
      request.url.includes('/spec/schema-definitions') ||
      /\/tools\/(?:builtin|api|workflow|mcp)$/.test(request.url)
    )
      return Response.json([])
    throw new Error(`Unexpected request: ${request.url}`)
  })
})
afterEach(() => {
  resolveSync?.(Response.json({ hash: 'next', updated_at: 1 }))
  vi.restoreAllMocks()
})

it('accepts new local fields and closes without waiting for the existing background draft request', async () => {
  const user = userEvent.setup()
  renderWorkflowFlowComponent(<DraftSidebarOwner />, { nodes: [], edges: [] })
  await user.click(
    screen.getByRole('button', { name: 'common.operation.add snippet.inputVariables' }),
  )
  await user.type(
    screen.getByRole('textbox', { name: 'appDebug.variableConfig.varName' }),
    'question',
  )
  const label = screen.getByRole('textbox', { name: 'appDebug.variableConfig.labelName' })
  await user.clear(label)
  await user.type(label, 'Question')
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await waitFor(() => expect(postedBody?.input_fields).toHaveLength(2))
  expect(useSnippetDraftStore.getState().inputFields).toEqual(
    expect.arrayContaining([expect.objectContaining({ variable: 'question', label: 'Question' })]),
  )
  expect(resolveSync).toBeDefined()
  await user.click(
    screen.getByRole('button', { name: 'common.operation.add snippet.inputVariables' }),
  )
  expect(screen.getByRole('textbox', { name: 'appDebug.variableConfig.varName' })).toHaveValue('')
})

it('rejects duplicate names and labels through the real editor, then accepts a correction', async () => {
  const user = userEvent.setup()
  renderWorkflowFlowComponent(<SidebarOwner />, { nodes: [], edges: [] })
  await user.click(
    screen.getByRole('button', { name: 'common.operation.add snippet.inputVariables' }),
  )
  const variable = screen.getByRole('textbox', { name: 'appDebug.variableConfig.varName' })
  const label = screen.getByRole('textbox', { name: 'appDebug.variableConfig.labelName' })
  await user.type(variable, 'query')
  await user.clear(label)
  await user.type(label, 'Other')
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  expect(changes).not.toHaveBeenCalled()
  await user.clear(variable)
  await user.type(variable, 'question')
  await user.clear(label)
  await user.type(label, 'Query')
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  expect(changes).not.toHaveBeenCalled()
  await user.clear(label)
  await user.type(label, 'Question')
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(changes).toHaveBeenCalledTimes(1)
})

it('keeps the existing navigation and hides mutation entries for readonly snippets', () => {
  renderWorkflowFlowComponent(<SidebarOwner readonly />, { nodes: [], edges: [] })
  expect(screen.getByRole('link', { name: 'snippet.sectionOrchestrate' })).toHaveAttribute(
    'href',
    '/snippets/snippet-1/orchestrate',
  )
  expect(
    screen.queryByRole('button', { name: 'common.operation.add snippet.inputVariables' }),
  ).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'common.operation.edit' })).not.toBeInTheDocument()
})

it('ignores an unchanged row save and forwards an accepted row edit through the real list', async () => {
  const user = userEvent.setup()
  renderWorkflowFlowComponent(<SidebarOwner />, { nodes: [], edges: [] })
  await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(changes).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
  const label = screen.getByRole('textbox', { name: 'appDebug.variableConfig.labelName' })
  await user.clear(label)
  await user.type(label, 'Updated query')
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(changes).toHaveBeenCalledExactlyOnceWith([{ ...initialFields[0], label: 'Updated query' }])
})
