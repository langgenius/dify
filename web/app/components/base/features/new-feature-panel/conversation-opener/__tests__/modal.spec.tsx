import type { OpeningStatement } from '@/app/components/base/features/types'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { replacePromptEditorText } from '@/app/components/base/prompt-editor/plugins/__tests__/test-helpers'
import { InputVarType } from '@/app/components/workflow/types'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import OpeningSettingModal from '../modal'

const defaultData: OpeningStatement = {
  enabled: true,
  opening_statement: 'Hello, how can I help?',
  suggested_questions: ['Question 1', 'Question 2'],
}
const getPromptEditor = () =>
  within(screen.getByTestId('opener-input-section')).getByRole('textbox')
const save = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'common.operation.save' }))
const dismissVariableCheck = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getAllByRole('button', { name: 'common.operation.cancel' }).at(-1)!)

describe('OpeningSettingModal', () => {
  it.each(['cancel', 'close', 'Escape'] as const)(
    'dismisses through %s without saving the draft',
    async (action) => {
      const user = userEvent.setup()
      const onCancel = vi.fn()
      const onSave = vi.fn()
      render(<OpeningSettingModal data={defaultData} onSave={onSave} onCancel={onCancel} />)
      await user.type(screen.getByDisplayValue('Question 1'), ' edited')
      if (action === 'Escape') await user.keyboard('{Escape}')
      else await user.click(screen.getByRole('button', { name: `common.operation.${action}` }))
      expect(onCancel).toHaveBeenCalledTimes(1)
      expect(onSave).not.toHaveBeenCalled()
    },
  )

  it('saves edits to the opener and added, edited, and deleted questions', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<OpeningSettingModal data={defaultData} onSave={onSave} onCancel={vi.fn()} />)
    expect(getPromptEditor()).toHaveTextContent(defaultData.opening_statement!)
    await replacePromptEditorText(getPromptEditor(), 'Welcome!')
    await user.clear(screen.getByDisplayValue('Question 1'))
    await user.type(
      screen.getAllByPlaceholderText('appDebug.openingStatement.openingQuestionPlaceholder')[0]!,
      'Updated question',
    )
    await user.click(screen.getByTestId('delete-question-Question 2'))
    expect(screen.queryByDisplayValue('Question 2')).not.toBeInTheDocument()
    await user.click(screen.getByText('appDebug.variableConfig.addOption'))
    const newQuestion = screen.getAllByPlaceholderText(
      'appDebug.openingStatement.openingQuestionPlaceholder',
    )[1]!
    expect(newQuestion).toHaveFocus()
    await user.type(newQuestion, 'New question')
    await save(user)
    expect(onSave).toHaveBeenCalledExactlyOnceWith({
      ...defaultData,
      opening_statement: 'Welcome!',
      suggested_questions: ['Updated question', 'New question'],
    })
  })

  it.each(['', '   '])('prevents saving an empty opener (%j)', async (opening_statement) => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(
      <OpeningSettingModal
        data={{ ...defaultData, opening_statement }}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'common.operation.save' })).toBeDisabled()
    await save(user)
    expect(onSave).not.toHaveBeenCalled()
  })

  it.each([[], undefined])(
    'saves an empty question list when initialized with %j',
    async (suggested_questions) => {
      const user = userEvent.setup()
      const onSave = vi.fn()
      render(
        <OpeningSettingModal
          data={{ ...defaultData, suggested_questions }}
          onSave={onSave}
          onCancel={vi.fn()}
        />,
      )
      await save(user)
      expect(onSave).toHaveBeenCalledExactlyOnceWith({ ...defaultData, suggested_questions: [] })
    },
  )

  it('offers adding a question again after deleting one at the limit', async () => {
    const user = userEvent.setup()
    render(
      <OpeningSettingModal
        data={{
          ...defaultData,
          suggested_questions: Array.from({ length: 10 }, (_, i) => `Q${i + 1}`),
        }}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.queryByText('appDebug.variableConfig.addOption')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('delete-question-Q1').parentElement!)
    await user.click(screen.getByText('appDebug.variableConfig.addOption'))
    expect(
      screen.getAllByPlaceholderText('appDebug.openingStatement.openingQuestionPlaceholder'),
    ).toHaveLength(10)
    expect(screen.queryByText('appDebug.variableConfig.addOption')).not.toBeInTheDocument()
  })

  it('requires confirmation for unknown variables and adds them before saving', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const onAutoAddPromptVariable = vi.fn()
    const data = { ...defaultData, opening_statement: 'Hello {{name}}' }
    render(
      <OpeningSettingModal
        data={data}
        onSave={onSave}
        onCancel={vi.fn()}
        onAutoAddPromptVariable={onAutoAddPromptVariable}
      />,
    )
    await save(user)
    expect(screen.getByText('appDebug.autoAddVar')).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'common.operation.add' }))
    expect(onAutoAddPromptVariable).toHaveBeenCalledExactlyOnceWith([
      expect.objectContaining({ key: 'name', name: 'name', type: 'string' }),
    ])
    expect(onSave).toHaveBeenCalledExactlyOnceWith(data)
    expect(screen.queryByText('appDebug.autoAddVar')).not.toBeInTheDocument()
  })

  it('allows saving without adding an unknown variable', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const onAutoAddPromptVariable = vi.fn()
    const data = { ...defaultData, opening_statement: 'Hello {{unknown}}' }
    render(
      <OpeningSettingModal
        data={data}
        onSave={onSave}
        onCancel={vi.fn()}
        onAutoAddPromptVariable={onAutoAddPromptVariable}
        workflowVariables={[
          { variable: 'name', label: 'Name', type: InputVarType.textInput, required: true },
        ]}
      />,
    )
    await save(user)
    expect(screen.getByText('appDebug.autoAddVar')).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()
    await dismissVariableCheck(user)
    expect(onSave).toHaveBeenCalledExactlyOnceWith(data)
    expect(onAutoAddPromptVariable).not.toHaveBeenCalled()
  })

  it.each(['prompt', 'workflow'] as const)(
    'saves known %s variables without confirmation',
    async (kind) => {
      const user = userEvent.setup()
      const onSave = vi.fn()
      const data = { ...defaultData, opening_statement: 'Hello {{name}}' }
      render(
        <OpeningSettingModal
          data={data}
          onSave={onSave}
          onCancel={vi.fn()}
          promptVariables={
            kind === 'prompt' ? [{ key: 'name', name: 'Name', type: 'string', required: true }] : []
          }
          workflowVariables={
            kind === 'workflow'
              ? [{ variable: 'name', label: 'Name', type: InputVarType.textInput, required: true }]
              : []
          }
        />,
      )
      await save(user)
      expect(screen.queryByText('appDebug.autoAddVar')).not.toBeInTheDocument()
      expect(onSave).toHaveBeenCalledExactlyOnceWith(data)
    },
  )

  it('updates the editor and saved opener when its data changes', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const view = render(
      <OpeningSettingModal data={defaultData} onSave={onSave} onCancel={vi.fn()} />,
    )
    view.rerender(
      <OpeningSettingModal
        data={{ ...defaultData, opening_statement: 'New greeting!' }}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    )
    await waitFor(() => expect(getPromptEditor()).toHaveTextContent('New greeting!'))
    await save(user)
    expect(onSave).toHaveBeenCalledExactlyOnceWith({
      ...defaultData,
      opening_statement: 'New greeting!',
    })
  })

  it('does not save if the opener becomes empty while variable confirmation is open', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const view = render(
      <OpeningSettingModal
        data={{ ...defaultData, opening_statement: 'Hello {{name}}' }}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    )
    await save(user)
    expect(screen.getByText('appDebug.autoAddVar')).toBeInTheDocument()
    view.rerender(
      <OpeningSettingModal
        data={{ ...defaultData, opening_statement: '   ' }}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    )
    await dismissVariableCheck(user)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('cancels keyboard sorting without dismissing the dialog, then saves a confirmed reorder', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const onCancel = vi.fn()
    render(<OpeningSettingModal data={defaultData} onSave={onSave} onCancel={onCancel} />)
    const handle = screen.getAllByRole('button', { name: /sort.handle/ })[0]!
    await user.click(handle)
    await user.keyboard('{Enter}{ArrowDown}{Escape}')
    expect(onCancel).not.toHaveBeenCalled()
    expect(
      screen
        .getAllByPlaceholderText('appDebug.openingStatement.openingQuestionPlaceholder')
        .map((input) => (input as HTMLInputElement).value),
    ).toEqual(['Question 1', 'Question 2'])
    expect(handle).toHaveFocus()
    await user.keyboard('{Enter}{ArrowDown}{Enter}')
    await user.clear(screen.getByDisplayValue('Question 2'))
    await user.type(
      screen.getAllByPlaceholderText('appDebug.openingStatement.openingQuestionPlaceholder')[0]!,
      'Edited after sorting',
    )
    await save(user)
    expect(onSave).toHaveBeenCalledExactlyOnceWith({
      ...defaultData,
      suggested_questions: ['Edited after sorting', 'Question 1'],
    })
  })
})
