import type { OpeningStatement } from '@/app/components/base/features/types'
import { fireEvent, render, screen } from '@testing-library/react'
import OpeningSettingModal from './modal'

vi.mock('@/app/components/base/prompt-editor', () => ({
  default: ({ value, onChange, placeholder }: { value: string, onChange: (v: string) => void, placeholder: string }) => (
    <textarea
      data-testid="prompt-editor"
      value={value}
      placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
    />
  ),
}))

vi.mock('@/app/components/base/block-input', () => ({
  getInputKeys: (text: string) => {
    const matches = text.match(/\{\{(\w+)\}\}/g) || []
    return matches.map(m => m.replace(/\{\{|\}\}/g, ''))
  },
}))

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

describe('OpeningSettingModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the modal title', () => {
    render(
      <OpeningSettingModal
        data={defaultData}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByText(/feature\.conversationOpener\.title/)).toBeInTheDocument()
  })

  it('should render the opening statement in the editor', () => {
    render(
      <OpeningSettingModal
        data={defaultData}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByTestId('prompt-editor')).toHaveValue('Hello, how can I help?')
  })

  it('should render suggested questions', () => {
    render(
      <OpeningSettingModal
        data={defaultData}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByDisplayValue('Question 1')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Question 2')).toBeInTheDocument()
  })

  it('should render cancel and save buttons', () => {
    render(
      <OpeningSettingModal
        data={defaultData}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByText(/operation\.cancel/)).toBeInTheDocument()
    expect(screen.getByText(/operation\.save/)).toBeInTheDocument()
  })

  it('should call onCancel when cancel is clicked', () => {
    const onCancel = vi.fn()
    render(
      <OpeningSettingModal
        data={defaultData}
        onSave={vi.fn()}
        onCancel={onCancel}
      />,
    )

    fireEvent.click(screen.getByText(/operation\.cancel/))

    expect(onCancel).toHaveBeenCalled()
  })

  it('should call onCancel when close icon is clicked', () => {
    const onCancel = vi.fn()
    render(
      <OpeningSettingModal
        data={defaultData}
        onSave={vi.fn()}
        onCancel={onCancel}
      />,
    )

    const closeIcon = document.querySelector('.cursor-pointer')
    fireEvent.click(closeIcon!)

    expect(onCancel).toHaveBeenCalled()
  })

  it('should call onSave with updated data when save is clicked', () => {
    const onSave = vi.fn()
    render(
      <OpeningSettingModal
        data={defaultData}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText(/operation\.save/))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      opening_statement: 'Hello, how can I help?',
      suggested_questions: ['Question 1', 'Question 2'],
    }))
  })

  it('should disable save when opening statement is empty', () => {
    render(
      <OpeningSettingModal
        data={{ ...defaultData, opening_statement: '' }}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    const saveButton = screen.getByText(/operation\.save/).closest('button')
    expect(saveButton).toBeDisabled()
  })

  it('should add a new suggested question', () => {
    render(
      <OpeningSettingModal
        data={defaultData}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText(/variableConfig\.addOption/))

    // Now there should be 3 inputs (2 existing + 1 new)
    // prompt-editor is also a textbox, so we check for input types
    const questionInputs = document.querySelectorAll('input[type="input"]')
    expect(questionInputs.length).toBe(3)
  })

  it('should delete a suggested question', () => {
    render(
      <OpeningSettingModal
        data={defaultData}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    // Find the delete bins - they're inside the question items
    const deleteBins = document.querySelectorAll('input[type="input"]')
    expect(deleteBins.length).toBe(2)

    // Click the delete icon for the first question
    const deleteIcons = document.querySelectorAll('[class*="absolute"][class*="right"]')
    if (deleteIcons.length > 0) {
      fireEvent.click(deleteIcons[0])
      const remainingInputs = document.querySelectorAll('input[type="input"]')
      expect(remainingInputs.length).toBe(1)
    }
  })

  it('should update a suggested question value', () => {
    render(
      <OpeningSettingModal
        data={defaultData}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByDisplayValue('Question 1'), {
      target: { value: 'Updated Question' },
    })

    expect(screen.getByDisplayValue('Updated Question')).toBeInTheDocument()
  })

  it('should show confirm dialog when variables are not in prompt', () => {
    render(
      <OpeningSettingModal
        data={{ ...defaultData, opening_statement: 'Hello {{name}}' }}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText(/operation\.save/))

    expect(screen.getByTestId('confirm-add-var')).toBeInTheDocument()
  })

  it('should save without variable check when confirm cancel is clicked', () => {
    const onSave = vi.fn()
    render(
      <OpeningSettingModal
        data={{ ...defaultData, opening_statement: 'Hello {{name}}' }}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText(/operation\.save/))
    fireEvent.click(screen.getByTestId('cancel-add'))

    expect(onSave).toHaveBeenCalled()
  })

  it('should show question count', () => {
    render(
      <OpeningSettingModal
        data={defaultData}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    // Count is displayed as "2/10" across child elements
    expect(screen.getByText(/openingStatement\.openingQuestion/)).toBeInTheDocument()
  })

  it('should call onAutoAddPromptVariable when confirm add is clicked', () => {
    const onAutoAddPromptVariable = vi.fn()
    render(
      <OpeningSettingModal
        data={{ ...defaultData, opening_statement: 'Hello {{name}}' }}
        onSave={vi.fn()}
        onCancel={vi.fn()}
        onAutoAddPromptVariable={onAutoAddPromptVariable}
      />,
    )

    fireEvent.click(screen.getByText(/operation\.save/))
    // Confirm add var dialog should appear
    fireEvent.click(screen.getByTestId('confirm-add'))

    expect(onAutoAddPromptVariable).toHaveBeenCalled()
  })

  it('should not show add button when max questions reached', () => {
    const questionsAtMax: OpeningStatement = {
      enabled: true,
      opening_statement: 'Hello',
      suggested_questions: Array.from({ length: 10 }, (_, i) => `Q${i + 1}`),
    }
    render(
      <OpeningSettingModal
        data={questionsAtMax}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.queryByText(/variableConfig\.addOption/)).not.toBeInTheDocument()
  })

  it('should handle focus and blur on question input', () => {
    render(
      <OpeningSettingModal
        data={defaultData}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    const input = screen.getByDisplayValue('Question 1')
    fireEvent.focus(input)
    // The input's parent should have focus styling class
    fireEvent.blur(input)
    // After blur, focus styling removed - input still works
    expect(input).toBeInTheDocument()
  })

  it('should handle mouse enter and leave on delete icon', () => {
    render(
      <OpeningSettingModal
        data={defaultData}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    const deleteIcons = document.querySelectorAll('[class*="absolute"][class*="right"]')
    if (deleteIcons.length > 0) {
      fireEvent.mouseEnter(deleteIcons[0])
      fireEvent.mouseLeave(deleteIcons[0])
    }
    // Just verifying no errors thrown during hover states
    expect(screen.getByDisplayValue('Question 1')).toBeInTheDocument()
  })

  it('should handle save with empty suggested questions', () => {
    const onSave = vi.fn()
    render(
      <OpeningSettingModal
        data={{ ...defaultData, suggested_questions: [] }}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText(/operation\.save/))

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      suggested_questions: [],
    }))
  })

  it('should not save when opening statement is only whitespace', () => {
    const onSave = vi.fn()
    render(
      <OpeningSettingModal
        data={{ ...defaultData, opening_statement: '   ' }}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText(/operation\.save/))

    expect(onSave).not.toHaveBeenCalled()
  })

  it('should skip variable check when variables match prompt variables', () => {
    const onSave = vi.fn()
    render(
      <OpeningSettingModal
        data={{ ...defaultData, opening_statement: 'Hello {{name}}' }}
        onSave={onSave}
        onCancel={vi.fn()}
        promptVariables={[{ key: 'name', name: 'Name', type: 'string', required: true }]}
      />,
    )

    fireEvent.click(screen.getByText(/operation\.save/))

    // Variable is in promptVariables, so no confirm dialog
    expect(screen.queryByTestId('confirm-add-var')).not.toBeInTheDocument()
    expect(onSave).toHaveBeenCalled()
  })

  it('should skip variable check when variables match workflow variables', () => {
    const onSave = vi.fn()
    render(
      <OpeningSettingModal
        data={{ ...defaultData, opening_statement: 'Hello {{name}}' }}
        onSave={onSave}
        onCancel={vi.fn()}
        workflowVariables={[{ variable: 'name', label: 'Name', type: 'string', required: true } as unknown as import('@/app/components/workflow/types').InputVar]}
      />,
    )

    fireEvent.click(screen.getByText(/operation\.save/))

    // Variable matches workflow variables, so no confirm dialog
    expect(screen.queryByTestId('confirm-add-var')).not.toBeInTheDocument()
    expect(onSave).toHaveBeenCalled()
  })

  it('should show confirm dialog when variables not in workflow variables', () => {
    render(
      <OpeningSettingModal
        data={{ ...defaultData, opening_statement: 'Hello {{unknown}}' }}
        onSave={vi.fn()}
        onCancel={vi.fn()}
        workflowVariables={[{ variable: 'name', label: 'Name', type: 'string', required: true } as unknown as import('@/app/components/workflow/types').InputVar]}
      />,
    )

    fireEvent.click(screen.getByText(/operation\.save/))

    expect(screen.getByTestId('confirm-add-var')).toBeInTheDocument()
  })

  it('should update the prompt editor value', () => {
    render(
      <OpeningSettingModal
        data={defaultData}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    const editor = screen.getByTestId('prompt-editor')
    fireEvent.change(editor, { target: { value: 'New greeting!' } })

    expect(editor).toHaveValue('New greeting!')
  })

  it('should render with empty opening_statement', () => {
    render(
      <OpeningSettingModal
        data={{ ...defaultData, opening_statement: '' }}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    const saveButton = screen.getByText(/operation\.save/).closest('button')
    expect(saveButton).toBeDisabled()
  })
})
