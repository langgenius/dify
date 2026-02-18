import type { OpeningStatement } from '@/app/components/base/features/types'
import type { InputVar } from '@/app/components/workflow/types'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InputVarType } from '@/app/components/workflow/types'
import OpeningSettingModal from './modal'

const getPromptEditor = () => {
  const editor = document.querySelector('[data-lexical-editor="true"]')
  expect(editor).toBeInTheDocument()
  return editor as HTMLElement
}

vi.mock('@/utils/var', () => ({
  checkKeys: (_keys: string[]) => ({ isValid: true }),
  getNewVar: (key: string, type: string) => ({ key, name: key, type, required: true }),
}))

vi.mock('@/app/components/app/configuration/config-prompt/confirm-add-var', () => ({
  default: ({ varNameArr, onConfirm, onCancel }: {
    varNameArr: string[]
    onConfirm: () => void
    onCancel: () => void
  }) => (
    <div data-testid="confirm-add-var">
      <span>{varNameArr.join(',')}</span>
      <button data-testid="confirm-add" onClick={onConfirm}>Confirm</button>
      <button data-testid="cancel-add" onClick={onCancel}>Cancel</button>
    </div>
  ),
}))

vi.mock('react-sortablejs', () => ({
  ReactSortable: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

const defaultData: OpeningStatement = {
  enabled: true,
  opening_statement: 'Hello, how can I help?',
  suggested_questions: ['Question 1', 'Question 2'],
}

const createMockInputVar = (overrides: Partial<InputVar> = {}): InputVar => ({
  variable: 'name',
  label: 'Name',
  type: InputVarType.textInput,
  required: true,
  ...overrides,
})

describe('OpeningSettingModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the modal title', async () => {
    await render(
      <OpeningSettingModal
        data={defaultData}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByText(/feature\.conversationOpener\.title/)).toBeInTheDocument()
  })

  it('should render the opening statement in the editor', async () => {
    await render(
      <OpeningSettingModal
        data={defaultData}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(getPromptEditor()).toHaveTextContent('Hello, how can I help?')
  })

  it('should render suggested questions', async () => {
    await render(
      <OpeningSettingModal
        data={defaultData}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByDisplayValue('Question 1')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Question 2')).toBeInTheDocument()
  })

  it('should render cancel and save buttons', async () => {
    await render(
      <OpeningSettingModal
        data={defaultData}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByText(/operation\.cancel/)).toBeInTheDocument()
    expect(screen.getByText(/operation\.save/)).toBeInTheDocument()
  })

  it('should call onCancel when cancel is clicked', async () => {
    const onCancel = vi.fn()
    await render(
      <OpeningSettingModal
        data={defaultData}
        onSave={vi.fn()}
        onCancel={onCancel}
      />,
    )

    await userEvent.click(screen.getByText(/operation\.cancel/))

    expect(onCancel).toHaveBeenCalled()
  })

  it('should call onCancel when close icon is clicked', async () => {
    const onCancel = vi.fn()
    await render(
      <OpeningSettingModal
        data={defaultData}
        onSave={vi.fn()}
        onCancel={onCancel}
      />,
    )

    const closeButton = screen.getByTestId('close-modal')
    await userEvent.click(closeButton)

    expect(onCancel).toHaveBeenCalled()
  })

  it('should call onCancel when close icon receives Enter key', async () => {
    const onCancel = vi.fn()
    await render(
      <OpeningSettingModal
        data={defaultData}
        onSave={vi.fn()}
        onCancel={onCancel}
      />,
    )

    const closeButton = screen.getByTestId('close-modal')
    closeButton.focus()
    await userEvent.keyboard('{Enter}')

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('should call onCancel when close icon receives Space key', async () => {
    const onCancel = vi.fn()
    await render(
      <OpeningSettingModal
        data={defaultData}
        onSave={vi.fn()}
        onCancel={onCancel}
      />,
    )

    const closeButton = screen.getByTestId('close-modal')
    closeButton.focus()
    fireEvent.keyDown(closeButton, { key: ' ' })

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('should call onSave with updated data when save is clicked', async () => {
    const onSave = vi.fn()
    await render(
      <OpeningSettingModal
        data={defaultData}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByText(/operation\.save/))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      opening_statement: 'Hello, how can I help?',
      suggested_questions: ['Question 1', 'Question 2'],
    }))
  })

  it('should disable save when opening statement is empty', async () => {
    await render(
      <OpeningSettingModal
        data={{ ...defaultData, opening_statement: '' }}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    const saveButton = screen.getByText(/operation\.save/).closest('button')
    expect(saveButton).toBeDisabled()
  })

  it('should add a new suggested question', async () => {
    await render(
      <OpeningSettingModal
        data={defaultData}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    // Before adding: 2 existing questions
    expect(screen.getByDisplayValue('Question 1')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Question 2')).toBeInTheDocument()

    await userEvent.click(screen.getByText(/variableConfig\.addOption/))

    // After adding: the 2 existing questions still present plus 1 new empty one
    expect(screen.getByDisplayValue('Question 1')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Question 2')).toBeInTheDocument()
    // The new empty question renders as an input with empty value
    const allInputs = screen.getAllByDisplayValue('')
    expect(allInputs.length).toBeGreaterThanOrEqual(1)
  })

  it('should delete a suggested question via save verification', async () => {
    const onSave = vi.fn()
    await render(
      <OpeningSettingModal
        data={{ ...defaultData, suggested_questions: ['Question 1'] }}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    )

    // Question should be present initially
    expect(screen.getByDisplayValue('Question 1')).toBeInTheDocument()

    const deleteIconWrapper = screen.getByTestId('delete-question-Question 1').parentElement
    expect(deleteIconWrapper).toBeTruthy()
    await userEvent.click(deleteIconWrapper!)

    // After deletion, Question 1 should be gone
    expect(screen.queryByDisplayValue('Question 1')).not.toBeInTheDocument()
  })

  it('should update a suggested question value', async () => {
    await render(
      <OpeningSettingModal
        data={defaultData}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    const input = screen.getByDisplayValue('Question 1')
    await userEvent.clear(input)
    await userEvent.type(input, 'Updated Question')

    expect(input).toHaveValue('Updated Question')
  })

  it('should show confirm dialog when variables are not in prompt', async () => {
    await render(
      <OpeningSettingModal
        data={{ ...defaultData, opening_statement: 'Hello {{name}}' }}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByText(/operation\.save/))

    expect(screen.getByTestId('confirm-add-var')).toBeInTheDocument()
  })

  it('should save without variable check when confirm cancel is clicked', async () => {
    const onSave = vi.fn()
    await render(
      <OpeningSettingModal
        data={{ ...defaultData, opening_statement: 'Hello {{name}}' }}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByText(/operation\.save/))
    await userEvent.click(screen.getByTestId('cancel-add'))

    expect(onSave).toHaveBeenCalled()
  })

  it('should show question count', async () => {
    await render(
      <OpeningSettingModal
        data={defaultData}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    // Count is displayed as "2/10" across child elements
    expect(screen.getByText(/openingStatement\.openingQuestion/)).toBeInTheDocument()
  })

  it('should call onAutoAddPromptVariable when confirm add is clicked', async () => {
    const onAutoAddPromptVariable = vi.fn()
    await render(
      <OpeningSettingModal
        data={{ ...defaultData, opening_statement: 'Hello {{name}}' }}
        onSave={vi.fn()}
        onCancel={vi.fn()}
        onAutoAddPromptVariable={onAutoAddPromptVariable}
      />,
    )

    await userEvent.click(screen.getByText(/operation\.save/))
    // Confirm add var dialog should appear
    await userEvent.click(screen.getByTestId('confirm-add'))

    expect(onAutoAddPromptVariable).toHaveBeenCalled()
  })

  it('should not show add button when max questions reached', async () => {
    const questionsAtMax: OpeningStatement = {
      enabled: true,
      opening_statement: 'Hello',
      suggested_questions: Array.from({ length: 10 }, (_, i) => `Q${i + 1}`),
    }
    await render(
      <OpeningSettingModal
        data={questionsAtMax}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.queryByText(/variableConfig\.addOption/)).not.toBeInTheDocument()
  })

  it('should apply and remove focused styling on question input focus/blur', async () => {
    await render(
      <OpeningSettingModal
        data={defaultData}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    const input = screen.getByDisplayValue('Question 1') as HTMLInputElement
    const questionRow = input.parentElement

    expect(input).toBeInTheDocument()
    expect(questionRow).not.toHaveClass('border-components-input-border-active')

    await userEvent.click(input)
    expect(questionRow).toHaveClass('border-components-input-border-active')

    // Tab press to blur
    await userEvent.tab()
    expect(questionRow).not.toHaveClass('border-components-input-border-active')
  })

  it('should apply and remove deleting styling on delete icon hover', async () => {
    await render(
      <OpeningSettingModal
        data={defaultData}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    const questionInput = screen.getByDisplayValue('Question 1') as HTMLInputElement
    const questionRow = questionInput.parentElement
    const deleteIconWrapper = screen.getByTestId('delete-question-Question 1').parentElement

    expect(questionRow).not.toHaveClass('border-components-input-border-destructive')
    expect(deleteIconWrapper).toBeTruthy()

    await userEvent.hover(deleteIconWrapper!)
    expect(questionRow).toHaveClass('border-components-input-border-destructive')

    await userEvent.unhover(deleteIconWrapper!)
    expect(questionRow).not.toHaveClass('border-components-input-border-destructive')
  })

  it('should handle save with empty suggested questions', async () => {
    const onSave = vi.fn()
    await render(
      <OpeningSettingModal
        data={{ ...defaultData, suggested_questions: [] }}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByText(/operation\.save/))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      suggested_questions: [],
    }))
  })

  it('should not save when opening statement is only whitespace', async () => {
    const onSave = vi.fn()
    await render(
      <OpeningSettingModal
        data={{ ...defaultData, opening_statement: '   ' }}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByText(/operation\.save/))

    expect(onSave).not.toHaveBeenCalled()
  })

  it('should skip variable check when variables match prompt variables', async () => {
    const onSave = vi.fn()
    await render(
      <OpeningSettingModal
        data={{ ...defaultData, opening_statement: 'Hello {{name}}' }}
        onSave={onSave}
        onCancel={vi.fn()}
        promptVariables={[{ key: 'name', name: 'Name', type: 'string', required: true }]}
      />,
    )

    await userEvent.click(screen.getByText(/operation\.save/))

    // Variable is in promptVariables, so no confirm dialog
    expect(screen.queryByTestId('confirm-add-var')).not.toBeInTheDocument()
    expect(onSave).toHaveBeenCalled()
  })

  it('should skip variable check when variables match workflow variables', async () => {
    const onSave = vi.fn()
    await render(
      <OpeningSettingModal
        data={{ ...defaultData, opening_statement: 'Hello {{name}}' }}
        onSave={onSave}
        onCancel={vi.fn()}
        workflowVariables={[createMockInputVar()]}
      />,
    )

    await userEvent.click(screen.getByText(/operation\.save/))

    // Variable matches workflow variables, so no confirm dialog
    expect(screen.queryByTestId('confirm-add-var')).not.toBeInTheDocument()
    expect(onSave).toHaveBeenCalled()
  })

  it('should show confirm dialog when variables not in workflow variables', async () => {
    await render(
      <OpeningSettingModal
        data={{ ...defaultData, opening_statement: 'Hello {{unknown}}' }}
        onSave={vi.fn()}
        onCancel={vi.fn()}
        workflowVariables={[createMockInputVar()]}
      />,
    )

    await userEvent.click(screen.getByText(/operation\.save/))

    expect(screen.getByTestId('confirm-add-var')).toBeInTheDocument()
  })

  it('should use updated opening statement after prop changes', async () => {
    const onSave = vi.fn()
    const view = await render(
      <OpeningSettingModal
        data={defaultData}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    )

    await act(async () => {
      view.rerender(
        <OpeningSettingModal
          data={{ ...defaultData, opening_statement: 'New greeting!' }}
          onSave={onSave}
          onCancel={vi.fn()}
        />,
      )
      await Promise.resolve()
      await new Promise(resolve => setTimeout(resolve, 0))
    })

    await userEvent.click(screen.getByText(/operation\.save/))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      opening_statement: 'New greeting!',
    }))
  })

  it('should render empty opening statement with placeholder in editor', async () => {
    await render(
      <OpeningSettingModal
        data={{ ...defaultData, opening_statement: '' }}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    const editor = getPromptEditor()
    expect(editor.textContent?.trim()).toBe('')
    expect(screen.getByText('appDebug.openingStatement.placeholder')).toBeInTheDocument()
  })
})
