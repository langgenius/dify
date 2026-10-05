import type { InputVar } from '@/app/components/workflow/types'
import type { PromptVariable } from '@/models/debug'
import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { cleanup, render } from 'vitest-browser-react'
import ConfigVar from '@/app/components/app/configuration/config-var'
import { InputVarType } from '@/app/components/workflow/types'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import VarList from '../var-list'

const clients: ReturnType<typeof createConsoleQueryWrapper>['queryClient'][] = []

function VariableListOwner() {
  const [variables, setVariables] = useState<InputVar[]>([
    {
      variable: 'question',
      label: 'A long variable label for layout',
      type: InputVarType.textInput,
      required: false,
      max_length: 48,
    },
  ])
  return (
    <div className="w-96 p-4">
      <button type="button">Before variables</button>
      <VarList readonly={false} list={variables} onChange={setVariables} />
    </div>
  )
}

beforeEach(() => {
  ;(
    globalThis as typeof globalThis & { BASE_UI_ANIMATIONS_DISABLED: boolean }
  ).BASE_UI_ANIMATIONS_DISABLED = false
})

afterEach(async () => {
  await cleanup()
  clients.splice(0).forEach((client) => client.clear())
  ;(
    globalThis as typeof globalThis & { BASE_UI_ANIMATIONS_DISABLED: boolean }
  ).BASE_UI_ANIMATIONS_DISABLED = true
})

it('keeps the renamed row dialog through exit and returns focus to its replacement edit button', async () => {
  const { queryClient } = createConsoleQueryWrapper()
  clients.push(queryClient)
  const screen = await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <VariableListOwner />
    </QueryClientTestProvider>,
  )
  await screen.getByRole('button', { name: 'Before variables' }).click()
  await userEvent.tab()
  const edit = screen.getByRole('button', { name: 'common.operation.edit' })
  await expect.element(edit).toHaveFocus()
  expect(edit.element().checkVisibility({ opacityProperty: true })).toBe(true)
  const labelRect = screen
    .getByText('A long variable label for layout', { exact: true })
    .element()
    .getBoundingClientRect()
  expect(labelRect.right).toBeLessThanOrEqual(edit.element().getBoundingClientRect().left)
  await userEvent.keyboard('{Enter}')
  const dialog = page.getByRole('dialog')
  await expect.element(dialog).toBeVisible()
  await dialog.getByRole('textbox', { name: 'appDebug.variableConfig.varName' }).fill('discarded')
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(edit).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect
    .element(dialog.getByRole('textbox', { name: 'appDebug.variableConfig.varName' }))
    .toHaveValue('question')
  await dialog.getByRole('textbox', { name: 'appDebug.variableConfig.varName' }).fill('renamed')
  const popup = dialog.element()
  const exitStarted = vi.fn()
  popup.addEventListener('transitionrun', () => {
    if (popup.hasAttribute('data-ending-style')) exitStarted()
  })
  await dialog.getByRole('button', { name: 'common.operation.save' }).click()
  await expect.poll(() => exitStarted.mock.calls.length).toBeGreaterThan(0)
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(screen.getByText('renamed', { exact: true })).toBeVisible()
  await expect.element(screen.getByRole('button', { name: 'common.operation.edit' })).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect
    .element(
      page.getByRole('dialog').getByRole('textbox', { name: 'appDebug.variableConfig.varName' }),
    )
    .toHaveValue('renamed')
})

function LegacyVariablesOwner() {
  const [variables, setVariables] = useState<PromptVariable[]>([
    { key: 'question', name: 'Question', type: 'string', required: false, max_length: 48 },
  ])
  return (
    <div className="w-96 p-4">
      <ConfigVar promptVariables={variables} onPromptVariablesChange={setVariables} />
    </div>
  )
}

it('returns a legacy configuration rename to the replacement edit entry', async () => {
  const { queryClient } = createConsoleQueryWrapper()
  clients.push(queryClient)
  const screen = await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <LegacyVariablesOwner />
    </QueryClientTestProvider>,
  )
  await screen.getByRole('button', { name: 'common.operation.edit' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox', { name: 'appDebug.variableConfig.varName' }).fill('renamed')
  await dialog.getByRole('button', { name: 'common.operation.save' }).click()
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(screen.getByText('renamed', { exact: true })).toBeVisible()
  await expect.element(screen.getByRole('button', { name: 'common.operation.edit' })).toHaveFocus()
})
