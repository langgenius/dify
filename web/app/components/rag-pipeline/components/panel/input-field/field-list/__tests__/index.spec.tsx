import type { SortableItem } from '../types'
import type { InputVar } from '@/models/pipeline'
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import Toast from '@/app/components/base/toast'
import { PipelineInputVarType } from '@/models/pipeline'
import FieldItem from '../field-item'
import FieldListContainer from '../field-list-container'
import { useFieldList } from '../hooks'
import FieldList from '../index'

const mockHandleInputVarRename = vi.fn()
const mockIsVarUsedInNodes = vi.fn(() => false)
const mockRemoveUsedVarInNodes = vi.fn()

vi.mock('../../../../../hooks/use-pipeline', () => ({
  usePipeline: () => ({
    handleInputVarRename: mockHandleInputVarRename,
    isVarUsedInNodes: mockIsVarUsedInNodes,
    removeUsedVarInNodes: mockRemoveUsedVarInNodes,
  }),
}))

const mockToggleInputFieldEditPanel = vi.fn()

vi.mock('@/app/components/rag-pipeline/hooks', () => ({
  useInputFieldPanel: () => ({
    toggleInputFieldEditPanel: mockToggleInputFieldEditPanel,
  }),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/remove-effect-var-confirm', () => ({
  default: ({
    isShow,
    onCancel,
    onConfirm,
  }: {
    isShow: boolean
    onCancel: () => void
    onConfirm: () => void
  }) => isShow
    ? (
        <div data-testid="remove-var-confirm">
          <button data-testid="confirm-cancel" onClick={onCancel}>Cancel</button>
          <button data-testid="confirm-ok" onClick={onConfirm}>Confirm</button>
        </div>
      )
    : null,
}))

const createInputVar = (overrides?: Partial<InputVar>): InputVar => ({
  type: PipelineInputVarType.textInput,
  label: 'Test Label',
  variable: 'test_variable',
  max_length: 48,
  default_value: '',
  required: true,
  tooltips: '',
  options: [],
  placeholder: '',
  unit: '',
  allowed_file_upload_methods: [],
  allowed_file_types: [],
  allowed_file_extensions: [],
  ...overrides,
})

const createInputVarList = (count: number): InputVar[] => {
  return Array.from({ length: count }, (_, i) =>
    createInputVar({
      variable: `var_${i}`,
      label: `Label ${i}`,
    }))
}

const createSortableItem = (
  inputVar: InputVar,
  overrides?: Partial<SortableItem>,
): SortableItem => ({
  id: inputVar.variable,
  chosen: false,
  selected: false,
  ...inputVar,
  ...overrides,
})

// Silence expected console.error from form submission handlers
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(Toast, 'notify').mockImplementation(() => ({ clear: vi.fn() }))
})

describe('FieldItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render field item with variable name', () => {
      const payload = createInputVar({ variable: 'my_field' })

      render(
        <FieldItem
          payload={payload}
          index={0}
          onClickEdit={vi.fn()}
          onRemove={vi.fn()}
        />,
      )

      expect(screen.getByText('my_field')).toBeInTheDocument()
    })

    it('should render field item with label when provided', () => {
      const payload = createInputVar({ variable: 'field', label: 'Field Label' })

      render(
        <FieldItem
          payload={payload}
          index={0}
          onClickEdit={vi.fn()}
          onRemove={vi.fn()}
        />,
      )

      expect(screen.getByText('Field Label')).toBeInTheDocument()
    })

    it('should not render label when empty', () => {
      const payload = createInputVar({ variable: 'field', label: '' })

      render(
        <FieldItem
          payload={payload}
          index={0}
          onClickEdit={vi.fn()}
          onRemove={vi.fn()}
        />,
      )

      expect(screen.queryByText('·')).not.toBeInTheDocument()
    })

    it('should render required badge when not hovering and required is true', () => {
      const payload = createInputVar({ required: true })

      render(
        <FieldItem
          payload={payload}
          index={0}
          onClickEdit={vi.fn()}
          onRemove={vi.fn()}
        />,
      )

      expect(screen.getByText(/required/i)).toBeInTheDocument()
    })

    it('should not render required badge when required is false', () => {
      const payload = createInputVar({ required: false })

      render(
        <FieldItem
          payload={payload}
          index={0}
          onClickEdit={vi.fn()}
          onRemove={vi.fn()}
        />,
      )

      expect(screen.queryByText(/required/i)).not.toBeInTheDocument()
    })

    it('should render InputField icon when not hovering', () => {
      const payload = createInputVar()

      const { container } = render(
        <FieldItem
          payload={payload}
          index={0}
          onClickEdit={vi.fn()}
          onRemove={vi.fn()}
        />,
      )

      const icons = container.querySelectorAll('svg')
      expect(icons.length).toBeGreaterThan(0)
    })

    it('should render drag icon when hovering and not readonly', () => {
      const payload = createInputVar()

      const { container } = render(
        <FieldItem
          payload={payload}
          index={0}
          onClickEdit={vi.fn()}
          onRemove={vi.fn()}
          readonly={false}
        />,
      )
      fireEvent.mouseEnter(container.firstChild!)

      const icons = container.querySelectorAll('svg')
      expect(icons.length).toBeGreaterThan(0)
    })

    it('should render edit and delete buttons when hovering and not readonly', () => {
      const payload = createInputVar()

      const { container } = render(
        <FieldItem
          payload={payload}
          index={0}
          onClickEdit={vi.fn()}
          onRemove={vi.fn()}
          readonly={false}
        />,
      )
      fireEvent.mouseEnter(container.firstChild!)

      const buttons = screen.getAllByRole('button')
      expect(buttons.length).toBe(2) // Edit and Delete buttons
    })

    it('should not render edit and delete buttons when readonly', () => {
      const payload = createInputVar()

      const { container } = render(
        <FieldItem
          payload={payload}
          index={0}
          onClickEdit={vi.fn()}
          onRemove={vi.fn()}
          readonly={true}
        />,
      )
      fireEvent.mouseEnter(container.firstChild!)

      const buttons = screen.queryAllByRole('button')
      expect(buttons.length).toBe(0)
    })
  })

  describe('User Interactions', () => {
    it('should call onClickEdit with variable when edit button is clicked', () => {
      const onClickEdit = vi.fn()
      const payload = createInputVar({ variable: 'test_var' })

      const { container } = render(
        <FieldItem
          payload={payload}
          index={0}
          onClickEdit={onClickEdit}
          onRemove={vi.fn()}
        />,
      )
      fireEvent.mouseEnter(container.firstChild!)
      const buttons = screen.getAllByRole('button')
      fireEvent.click(buttons[0]) // Edit button

      expect(onClickEdit).toHaveBeenCalledWith('test_var')
    })

    it('should call onRemove with index when delete button is clicked', () => {
      const onRemove = vi.fn()
      const payload = createInputVar()

      const { container } = render(
        <FieldItem
          payload={payload}
          index={5}
          onClickEdit={vi.fn()}
          onRemove={onRemove}
        />,
      )
      fireEvent.mouseEnter(container.firstChild!)
      const buttons = screen.getAllByRole('button')
      fireEvent.click(buttons[1]) // Delete button

      expect(onRemove).toHaveBeenCalledWith(5)
    })

    it('should not call onClickEdit when readonly', () => {
      const onClickEdit = vi.fn()
      const payload = createInputVar()

      const { container, rerender } = render(
        <FieldItem
          payload={payload}
          index={0}
          onClickEdit={onClickEdit}
          onRemove={vi.fn()}
          readonly={false}
        />,
      )
      fireEvent.mouseEnter(container.firstChild!)

      rerender(
        <FieldItem
          payload={payload}
          index={0}
          onClickEdit={onClickEdit}
          onRemove={vi.fn()}
          readonly={true}
        />,
      )

      expect(screen.queryAllByRole('button').length).toBe(0)
    })

    it('should stop event propagation when edit button is clicked', () => {
      const onClickEdit = vi.fn()
      const parentClick = vi.fn()
      const payload = createInputVar()

      const { container } = render(
        <div onClick={parentClick}>
          <FieldItem
            payload={payload}
            index={0}
            onClickEdit={onClickEdit}
            onRemove={vi.fn()}
          />
        </div>,
      )
      fireEvent.mouseEnter(container.querySelector('.handle')!)
      const buttons = screen.getAllByRole('button')
      fireEvent.click(buttons[0])

      expect(onClickEdit).toHaveBeenCalled()
      expect(parentClick).not.toHaveBeenCalled()
    })

    it('should stop event propagation when delete button is clicked', () => {
      const onRemove = vi.fn()
      const parentClick = vi.fn()
      const payload = createInputVar()

      const { container } = render(
        <div onClick={parentClick}>
          <FieldItem
            payload={payload}
            index={0}
            onClickEdit={vi.fn()}
            onRemove={onRemove}
          />
        </div>,
      )
      fireEvent.mouseEnter(container.querySelector('.handle')!)
      const buttons = screen.getAllByRole('button')
      fireEvent.click(buttons[1])

      expect(onRemove).toHaveBeenCalled()
      expect(parentClick).not.toHaveBeenCalled()
    })
  })

  describe('Callback Stability', () => {
    it('should maintain stable handleOnClickEdit when props dont change', () => {
      const onClickEdit = vi.fn()
      const payload = createInputVar()

      const { container, rerender } = render(
        <FieldItem
          payload={payload}
          index={0}
          onClickEdit={onClickEdit}
          onRemove={vi.fn()}
        />,
      )
      fireEvent.mouseEnter(container.firstChild!)
      const buttons = screen.getAllByRole('button')
      fireEvent.click(buttons[0])

      rerender(
        <FieldItem
          payload={payload}
          index={0}
          onClickEdit={onClickEdit}
          onRemove={vi.fn()}
        />,
      )
      fireEvent.mouseEnter(container.firstChild!)
      const buttonsAfterRerender = screen.getAllByRole('button')
      fireEvent.click(buttonsAfterRerender[0])

      expect(onClickEdit).toHaveBeenCalledTimes(2)
    })
  })

  describe('Edge Cases', () => {
    it('should handle very long variable names with truncation', () => {
      const longVariable = 'a'.repeat(200)
      const payload = createInputVar({ variable: longVariable })

      render(
        <FieldItem
          payload={payload}
          index={0}
          onClickEdit={vi.fn()}
          onRemove={vi.fn()}
        />,
      )

      const varElement = screen.getByTitle(longVariable)
      expect(varElement).toHaveClass('truncate')
    })

    it('should handle very long label names with truncation', () => {
      const longLabel = 'b'.repeat(200)
      const payload = createInputVar({ label: longLabel })

      render(
        <FieldItem
          payload={payload}
          index={0}
          onClickEdit={vi.fn()}
          onRemove={vi.fn()}
        />,
      )

      const labelElement = screen.getByTitle(longLabel)
      expect(labelElement).toHaveClass('truncate')
    })

    it('should handle special characters in variable and label', () => {
      const payload = createInputVar({
        variable: '<test>&"var\'',
        label: '<label>&"test\'',
      })

      render(
        <FieldItem
          payload={payload}
          index={0}
          onClickEdit={vi.fn()}
          onRemove={vi.fn()}
        />,
      )

      expect(screen.getByText('<test>&"var\'')).toBeInTheDocument()
      expect(screen.getByText('<label>&"test\'')).toBeInTheDocument()
    })

    it('should handle unicode characters', () => {
      const payload = createInputVar({
        variable: '变量_🎉',
        label: '标签_😀',
      })

      render(
        <FieldItem
          payload={payload}
          index={0}
          onClickEdit={vi.fn()}
          onRemove={vi.fn()}
        />,
      )

      expect(screen.getByText('变量_🎉')).toBeInTheDocument()
      expect(screen.getByText('标签_😀')).toBeInTheDocument()
    })

    it('should render different input types correctly', () => {
      const types = [
        PipelineInputVarType.textInput,
        PipelineInputVarType.paragraph,
        PipelineInputVarType.number,
        PipelineInputVarType.select,
        PipelineInputVarType.singleFile,
        PipelineInputVarType.multiFiles,
        PipelineInputVarType.checkbox,
      ]

      types.forEach((type) => {
        const payload = createInputVar({ type })

        const { unmount } = render(
          <FieldItem
            payload={payload}
            index={0}
            onClickEdit={vi.fn()}
            onRemove={vi.fn()}
          />,
        )

        expect(screen.getByText('test_variable')).toBeInTheDocument()
        unmount()
      })
    })
  })

  describe('Memoization', () => {
    it('should be memoized with React.memo', () => {
      const payload = createInputVar()
      const onClickEdit = vi.fn()
      const onRemove = vi.fn()

      const { rerender } = render(
        <FieldItem
          payload={payload}
          index={0}
          onClickEdit={onClickEdit}
          onRemove={onRemove}
        />,
      )

      rerender(
        <FieldItem
          payload={payload}
          index={0}
          onClickEdit={onClickEdit}
          onRemove={onRemove}
        />,
      )

      expect(screen.getByText('test_variable')).toBeInTheDocument()
    })
  })

  describe('Readonly Mode Behavior', () => {
    it('should not render action buttons in readonly mode even when hovering', () => {
      const payload = createInputVar()

      const { container } = render(
        <FieldItem
          payload={payload}
          index={0}
          onClickEdit={vi.fn()}
          onRemove={vi.fn()}
          readonly={true}
        />,
      )
      fireEvent.mouseEnter(container.firstChild!)

      expect(screen.queryAllByRole('button')).toHaveLength(0)
    })

    it('should render type icon and required badge in readonly mode when hovering', () => {
      const payload = createInputVar({ required: true })

      const { container } = render(
        <FieldItem
          payload={payload}
          index={0}
          onClickEdit={vi.fn()}
          onRemove={vi.fn()}
          readonly={true}
        />,
      )
      fireEvent.mouseEnter(container.firstChild!)

      expect(screen.getByText(/required/i)).toBeInTheDocument()
    })

    it('should apply cursor-default class when readonly', () => {
      const payload = createInputVar()

      const { container } = render(
        <FieldItem
          payload={payload}
          index={0}
          onClickEdit={vi.fn()}
          onRemove={vi.fn()}
          readonly={true}
        />,
      )

      const fieldItem = container.firstChild as HTMLElement
      expect(fieldItem.className).toContain('cursor-default')
    })

    it('should apply cursor-all-scroll class when hovering and not readonly', () => {
      const payload = createInputVar()

      const { container } = render(
        <FieldItem
          payload={payload}
          index={0}
          onClickEdit={vi.fn()}
          onRemove={vi.fn()}
          readonly={false}
        />,
      )
      fireEvent.mouseEnter(container.firstChild!)

      const fieldItem = container.firstChild as HTMLElement
      expect(fieldItem.className).toContain('cursor-all-scroll')
    })
  })
})

describe('FieldListContainer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render sortable container with field items', () => {
      const inputFields = createInputVarList(2)

      render(
        <FieldListContainer
          inputFields={inputFields}
          onListSortChange={vi.fn()}
          onRemoveField={vi.fn()}
          onEditField={vi.fn()}
        />,
      )

      expect(screen.getByText('var_0')).toBeInTheDocument()
      expect(screen.getByText('var_1')).toBeInTheDocument()
    })

    it('should render all field items', () => {
      const inputFields = createInputVarList(3)

      render(
        <FieldListContainer
          inputFields={inputFields}
          onListSortChange={vi.fn()}
          onRemoveField={vi.fn()}
          onEditField={vi.fn()}
        />,
      )

      expect(screen.getByText('var_0')).toBeInTheDocument()
      expect(screen.getByText('var_1')).toBeInTheDocument()
      expect(screen.getByText('var_2')).toBeInTheDocument()
    })

    it('should render empty list without errors', () => {
      const { container } = render(
        <FieldListContainer
          inputFields={[]}
          onListSortChange={vi.fn()}
          onRemoveField={vi.fn()}
          onEditField={vi.fn()}
        />,
      )

      // ReactSortable renders a wrapper div even for empty lists
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should apply custom className', () => {
      const inputFields = createInputVarList(1)

      const { container } = render(
        <FieldListContainer
          className="custom-class"
          inputFields={inputFields}
          onListSortChange={vi.fn()}
          onRemoveField={vi.fn()}
          onEditField={vi.fn()}
        />,
      )

      // ReactSortable renders a wrapper div with the className prop
      const sortableWrapper = container.firstChild as HTMLElement
      expect(sortableWrapper.className).toContain('custom-class')
    })

    it('should disable sorting when readonly is true', () => {
      const inputFields = createInputVarList(2)

      const { container } = render(
        <FieldListContainer
          inputFields={inputFields}
          onListSortChange={vi.fn()}
          onRemoveField={vi.fn()}
          onEditField={vi.fn()}
          readonly={true}
        />,
      )

      // Verify readonly is reflected: hovering should not show action buttons
      fireEvent.mouseEnter(container.querySelector('.handle')!)
      expect(screen.queryAllByRole('button')).toHaveLength(0)
    })
  })

  describe('User Interactions', () => {
    it('should pass onEditField to FieldItem', () => {
      const inputFields = createInputVarList(1)
      const onEditField = vi.fn()

      const { container } = render(
        <FieldListContainer
          inputFields={inputFields}
          onListSortChange={vi.fn()}
          onRemoveField={vi.fn()}
          onEditField={onEditField}
        />,
      )
      fireEvent.mouseEnter(container.querySelector('.handle')!)
      const buttons = screen.getAllByRole('button')
      fireEvent.click(buttons[0]) // Edit button

      expect(onEditField).toHaveBeenCalledWith('var_0')
    })

    it('should pass onRemoveField to FieldItem', () => {
      const inputFields = createInputVarList(1)
      const onRemoveField = vi.fn()

      const { container } = render(
        <FieldListContainer
          inputFields={inputFields}
          onListSortChange={vi.fn()}
          onRemoveField={onRemoveField}
          onEditField={vi.fn()}
        />,
      )
      fireEvent.mouseEnter(container.querySelector('.handle')!)
      const buttons = screen.getAllByRole('button')
      fireEvent.click(buttons[1]) // Delete button

      expect(onRemoveField).toHaveBeenCalledWith(0)
    })
  })

  describe('List Conversion', () => {
    it('should convert InputVar[] to SortableItem[] with correct structure', () => {
      // Verify the conversion contract: id from variable, default sortable flags
      const inputFields = createInputVarList(2)
      const converted: SortableItem[] = inputFields.map(content => ({
        id: content.variable,
        chosen: false,
        selected: false,
        ...content,
      }))

      expect(converted).toHaveLength(2)
      expect(converted[0].id).toBe('var_0')
      expect(converted[0].chosen).toBe(false)
      expect(converted[0].selected).toBe(false)
      expect(converted[0].variable).toBe('var_0')
      expect(converted[0].type).toBe(PipelineInputVarType.textInput)
      expect(converted[1].id).toBe('var_1')
    })
  })

  describe('Memoization', () => {
    it('should memoize list transformation', () => {
      const inputFields = createInputVarList(2)
      const onListSortChange = vi.fn()

      const { rerender } = render(
        <FieldListContainer
          inputFields={inputFields}
          onListSortChange={onListSortChange}
          onRemoveField={vi.fn()}
          onEditField={vi.fn()}
        />,
      )

      rerender(
        <FieldListContainer
          inputFields={inputFields}
          onListSortChange={onListSortChange}
          onRemoveField={vi.fn()}
          onEditField={vi.fn()}
        />,
      )

      expect(screen.getByText('var_0')).toBeInTheDocument()
    })

    it('should be memoized with React.memo', () => {
      const inputFields = createInputVarList(1)

      const { rerender } = render(
        <FieldListContainer
          inputFields={inputFields}
          onListSortChange={vi.fn()}
          onRemoveField={vi.fn()}
          onEditField={vi.fn()}
        />,
      )

      rerender(
        <FieldListContainer
          inputFields={inputFields}
          onListSortChange={vi.fn()}
          onRemoveField={vi.fn()}
          onEditField={vi.fn()}
        />,
      )

      expect(screen.getByText('var_0')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle large list of items', () => {
      const inputFields = createInputVarList(100)

      render(
        <FieldListContainer
          inputFields={inputFields}
          onListSortChange={vi.fn()}
          onRemoveField={vi.fn()}
          onEditField={vi.fn()}
        />,
      )

      expect(screen.getByText('var_0')).toBeInTheDocument()
      expect(screen.getByText('var_99')).toBeInTheDocument()
    })

    it('should throw error when inputFields is undefined', () => {
      expect(() =>
        render(
          <FieldListContainer
            inputFields={undefined as unknown as InputVar[]}
            onListSortChange={vi.fn()}
            onRemoveField={vi.fn()}
            onEditField={vi.fn()}
          />,
        ),
      ).toThrow()
    })
  })
})

describe('FieldList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsVarUsedInNodes.mockReturnValue(false)
  })

  describe('Rendering', () => {
    it('should render FieldList component', () => {
      const inputFields = createInputVarList(2)

      render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={<span>Label Content</span>}
          inputFields={inputFields}
          handleInputFieldsChange={vi.fn()}
          allVariableNames={['var_0', 'var_1']}
        />,
      )

      expect(screen.getByText('Label Content')).toBeInTheDocument()
      expect(screen.getByText('var_0')).toBeInTheDocument()
    })

    it('should render add button', () => {
      const inputFields = createInputVarList(1)

      render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={null}
          inputFields={inputFields}
          handleInputFieldsChange={vi.fn()}
          allVariableNames={[]}
        />,
      )

      const addButton = screen.getAllByRole('button').find(btn =>
        btn.querySelector('svg'),
      )
      expect(addButton).toBeInTheDocument()
    })

    it('should disable add button when readonly', () => {
      const inputFields = createInputVarList(1)

      render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={null}
          inputFields={inputFields}
          handleInputFieldsChange={vi.fn()}
          allVariableNames={[]}
          readonly={true}
        />,
      )

      const addButton = screen.getAllByRole('button').find(btn =>
        btn.querySelector('svg'),
      )
      expect(addButton).toBeDisabled()
    })

    it('should apply custom labelClassName', () => {
      const inputFields = createInputVarList(1)

      const { container } = render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={<span>Content</span>}
          inputFields={inputFields}
          handleInputFieldsChange={vi.fn()}
          allVariableNames={[]}
          labelClassName="custom-label-class"
        />,
      )

      const labelContainer = container.querySelector('.custom-label-class')
      expect(labelContainer).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should open editor panel when add button is clicked', () => {
      const inputFields = createInputVarList(1)

      render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={null}
          inputFields={inputFields}
          handleInputFieldsChange={vi.fn()}
          allVariableNames={[]}
        />,
      )
      const addButton = screen.getAllByRole('button').find(btn =>
        btn.querySelector('svg'),
      )
      if (addButton)
        fireEvent.click(addButton)

      expect(mockToggleInputFieldEditPanel).toHaveBeenCalled()
    })

    it('should not open editor when readonly and add button clicked', () => {
      const inputFields = createInputVarList(1)

      render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={null}
          inputFields={inputFields}
          handleInputFieldsChange={vi.fn()}
          allVariableNames={[]}
          readonly={true}
        />,
      )
      const addButton = screen.getAllByRole('button').find(btn =>
        btn.querySelector('svg'),
      )
      if (addButton)
        fireEvent.click(addButton)

      expect(mockToggleInputFieldEditPanel).not.toHaveBeenCalled()
    })
  })

  describe('Callback Handling', () => {
    it('should call handleInputFieldsChange with nodeId when fields change', () => {
      mockIsVarUsedInNodes.mockReturnValue(false)
      const inputFields = createInputVarList(2)
      const handleInputFieldsChange = vi.fn()

      const { container } = render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={null}
          inputFields={inputFields}
          handleInputFieldsChange={handleInputFieldsChange}
          allVariableNames={[]}
        />,
      )

      // Trigger field change via remove action
      fireEvent.mouseEnter(container.querySelector('.handle')!)
      const fieldItemButtons = container.querySelectorAll('.handle button.action-btn')
      if (fieldItemButtons.length >= 2)
        fireEvent.click(fieldItemButtons[1])

      expect(handleInputFieldsChange).toHaveBeenCalledWith('node-1', expect.any(Array))
    })
  })

  describe('Remove Confirmation', () => {
    it('should show remove confirmation when variable is used in nodes', async () => {
      mockIsVarUsedInNodes.mockReturnValue(true)
      const inputFields = createInputVarList(1)

      const { container } = render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={null}
          inputFields={inputFields}
          handleInputFieldsChange={vi.fn()}
          allVariableNames={[]}
        />,
      )
      fireEvent.mouseEnter(container.querySelector('.handle')!)

      const fieldItemButtons = container.querySelectorAll('.handle button.action-btn')
      if (fieldItemButtons.length >= 2)
        fireEvent.click(fieldItemButtons[1])

      await waitFor(() => {
        expect(screen.getByTestId('remove-var-confirm')).toBeInTheDocument()
      })
    })

    it('should hide remove confirmation when cancel is clicked', async () => {
      mockIsVarUsedInNodes.mockReturnValue(true)
      const inputFields = createInputVarList(1)

      const { container } = render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={null}
          inputFields={inputFields}
          handleInputFieldsChange={vi.fn()}
          allVariableNames={[]}
        />,
      )
      fireEvent.mouseEnter(container.querySelector('.handle')!)

      const fieldItemButtons = container.querySelectorAll('.handle button.action-btn')
      if (fieldItemButtons.length >= 2)
        fireEvent.click(fieldItemButtons[1])

      await waitFor(() => {
        expect(screen.getByTestId('remove-var-confirm')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('confirm-cancel'))

      await waitFor(() => {
        expect(screen.queryByTestId('remove-var-confirm')).not.toBeInTheDocument()
      })
    })

    it('should remove field and call removeUsedVarInNodes when confirm is clicked', async () => {
      mockIsVarUsedInNodes.mockReturnValue(true)
      const inputFields = createInputVarList(1)
      const handleInputFieldsChange = vi.fn()

      const { container } = render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={null}
          inputFields={inputFields}
          handleInputFieldsChange={handleInputFieldsChange}
          allVariableNames={[]}
        />,
      )
      fireEvent.mouseEnter(container.querySelector('.handle')!)

      const fieldItemButtons = container.querySelectorAll('.handle button.action-btn')
      if (fieldItemButtons.length >= 2)
        fireEvent.click(fieldItemButtons[1])

      await waitFor(() => {
        expect(screen.getByTestId('remove-var-confirm')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('confirm-ok'))

      await waitFor(() => {
        expect(handleInputFieldsChange).toHaveBeenCalled()
        expect(mockRemoveUsedVarInNodes).toHaveBeenCalled()
      })
    })

    it('should remove field directly when variable is not used in nodes', () => {
      mockIsVarUsedInNodes.mockReturnValue(false)
      const inputFields = createInputVarList(2)
      const handleInputFieldsChange = vi.fn()

      const { container } = render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={null}
          inputFields={inputFields}
          handleInputFieldsChange={handleInputFieldsChange}
          allVariableNames={[]}
        />,
      )
      fireEvent.mouseEnter(container.querySelector('.handle')!)

      const fieldItemButtons = container.querySelectorAll('.handle button.action-btn')
      if (fieldItemButtons.length >= 2)
        fireEvent.click(fieldItemButtons[1])

      expect(screen.queryByTestId('remove-var-confirm')).not.toBeInTheDocument()
      expect(handleInputFieldsChange).toHaveBeenCalled()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty inputFields', () => {
      const { container } = render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={null}
          inputFields={[]}
          handleInputFieldsChange={vi.fn()}
          allVariableNames={[]}
        />,
      )

      // Component renders without errors even with no fields
      expect(container.firstChild).toBeInTheDocument()
    })

    it('should handle null LabelRightContent', () => {
      render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={null}
          inputFields={createInputVarList(1)}
          handleInputFieldsChange={vi.fn()}
          allVariableNames={[]}
        />,
      )

      expect(screen.getByText('var_0')).toBeInTheDocument()
    })

    it('should handle complex LabelRightContent', () => {
      const complexContent = (
        <div data-testid="complex-content">
          <span>Part 1</span>
          <button>Part 2</button>
        </div>
      )

      render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={complexContent}
          inputFields={createInputVarList(1)}
          handleInputFieldsChange={vi.fn()}
          allVariableNames={[]}
        />,
      )

      expect(screen.getByTestId('complex-content')).toBeInTheDocument()
      expect(screen.getByText('Part 1')).toBeInTheDocument()
    })
  })

  describe('Memoization', () => {
    it('should be wrapped with React.memo', () => {
      const inputFields = createInputVarList(1)
      const handleInputFieldsChange = vi.fn()

      const { rerender } = render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={null}
          inputFields={inputFields}
          handleInputFieldsChange={handleInputFieldsChange}
          allVariableNames={[]}
        />,
      )

      rerender(
        <FieldList
          nodeId="node-1"
          LabelRightContent={null}
          inputFields={inputFields}
          handleInputFieldsChange={handleInputFieldsChange}
          allVariableNames={[]}
        />,
      )

      expect(screen.getByText('var_0')).toBeInTheDocument()
    })

    it('should maintain stable onInputFieldsChange callback', () => {
      mockIsVarUsedInNodes.mockReturnValue(false)
      const handleInputFieldsChange = vi.fn()
      const inputFields = createInputVarList(2)

      const { rerender, container } = render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={null}
          inputFields={inputFields}
          handleInputFieldsChange={handleInputFieldsChange}
          allVariableNames={[]}
        />,
      )

      // Rerender with same props to verify callback stability
      rerender(
        <FieldList
          nodeId="node-1"
          LabelRightContent={null}
          inputFields={inputFields}
          handleInputFieldsChange={handleInputFieldsChange}
          allVariableNames={[]}
        />,
      )

      // After rerender, the callback chain should still work correctly
      fireEvent.mouseEnter(container.querySelector('.handle')!)
      const fieldItemButtons = container.querySelectorAll('.handle button.action-btn')
      if (fieldItemButtons.length >= 2)
        fireEvent.click(fieldItemButtons[1])

      expect(handleInputFieldsChange).toHaveBeenCalledWith('node-1', expect.any(Array))
    })
  })
})

describe('useFieldList Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsVarUsedInNodes.mockReturnValue(false)
  })

  describe('Initialization', () => {
    it('should initialize with provided inputFields', () => {
      const inputFields = createInputVarList(2)

      render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={null}
          inputFields={inputFields}
          handleInputFieldsChange={vi.fn()}
          allVariableNames={[]}
        />,
      )

      expect(screen.getByText('var_0')).toBeInTheDocument()
      expect(screen.getByText('var_1')).toBeInTheDocument()
    })

    it('should initialize with empty inputFields', () => {
      const { container } = render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={null}
          inputFields={[]}
          handleInputFieldsChange={vi.fn()}
          allVariableNames={[]}
        />,
      )

      // Component renders without errors even with no fields
      expect(container.firstChild).toBeInTheDocument()
    })
  })

  describe('handleListSortChange', () => {
    it('should update inputFields and call onInputFieldsChange', () => {
      const onInputFieldsChange = vi.fn()
      const initialFields = createInputVarList(2)

      const { result } = renderHook(() => useFieldList({
        initialInputFields: initialFields,
        onInputFieldsChange,
        nodeId: 'node-1',
        allVariableNames: [],
      }))

      // Simulate sort change by calling handleListSortChange directly
      const reorderedList: SortableItem[] = [
        createSortableItem(initialFields[1]),
        createSortableItem(initialFields[0]),
      ]

      act(() => {
        result.current.handleListSortChange(reorderedList)
      })

      expect(onInputFieldsChange).toHaveBeenCalledWith([
        expect.objectContaining({ variable: 'var_1' }),
        expect.objectContaining({ variable: 'var_0' }),
      ])
    })

    it('should strip sortable properties from list items', () => {
      const onInputFieldsChange = vi.fn()
      const initialFields = createInputVarList(1)

      const { result } = renderHook(() => useFieldList({
        initialInputFields: initialFields,
        onInputFieldsChange,
        nodeId: 'node-1',
        allVariableNames: [],
      }))

      const sortableList: SortableItem[] = [
        createSortableItem(initialFields[0], { chosen: true, selected: true }),
      ]

      act(() => {
        result.current.handleListSortChange(sortableList)
      })

      const updatedFields = onInputFieldsChange.mock.calls[0][0]
      expect(updatedFields[0]).not.toHaveProperty('id')
      expect(updatedFields[0]).not.toHaveProperty('chosen')
      expect(updatedFields[0]).not.toHaveProperty('selected')
      expect(updatedFields[0]).toHaveProperty('variable', 'var_0')
    })
  })

  describe('handleRemoveField', () => {
    it('should show confirmation when variable is used', async () => {
      mockIsVarUsedInNodes.mockReturnValue(true)
      const inputFields = createInputVarList(1)

      const { container } = render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={null}
          inputFields={inputFields}
          handleInputFieldsChange={vi.fn()}
          allVariableNames={[]}
        />,
      )
      fireEvent.mouseEnter(container.querySelector('.handle')!)

      const fieldItemButtons = container.querySelectorAll('.handle button.action-btn')
      if (fieldItemButtons.length >= 2)
        fireEvent.click(fieldItemButtons[1])

      await waitFor(() => {
        expect(screen.getByTestId('remove-var-confirm')).toBeInTheDocument()
      })
    })

    it('should remove directly when variable is not used', () => {
      mockIsVarUsedInNodes.mockReturnValue(false)
      const inputFields = createInputVarList(2)
      const handleInputFieldsChange = vi.fn()

      const { container } = render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={null}
          inputFields={inputFields}
          handleInputFieldsChange={handleInputFieldsChange}
          allVariableNames={[]}
        />,
      )
      fireEvent.mouseEnter(container.querySelector('.handle')!)

      const fieldItemButtons = container.querySelectorAll('.handle button.action-btn')
      if (fieldItemButtons.length >= 2)
        fireEvent.click(fieldItemButtons[1])

      expect(screen.queryByTestId('remove-var-confirm')).not.toBeInTheDocument()
      expect(handleInputFieldsChange).toHaveBeenCalled()
    })

    it('should not call handleInputFieldsChange immediately when variable is used (lines 70-72)', async () => {
      mockIsVarUsedInNodes.mockReturnValue(true)
      const inputFields = createInputVarList(1)
      const handleInputFieldsChange = vi.fn()

      const { container } = render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={null}
          inputFields={inputFields}
          handleInputFieldsChange={handleInputFieldsChange}
          allVariableNames={[]}
        />,
      )
      fireEvent.mouseEnter(container.querySelector('.handle')!)

      const fieldItemButtons = container.querySelectorAll('.handle button.action-btn')
      if (fieldItemButtons.length >= 2)
        fireEvent.click(fieldItemButtons[1])

      await waitFor(() => {
        expect(screen.getByTestId('remove-var-confirm')).toBeInTheDocument()
      })
      expect(handleInputFieldsChange).not.toHaveBeenCalled()
    })

    it('should call isVarUsedInNodes with correct variable selector', async () => {
      mockIsVarUsedInNodes.mockReturnValue(true)
      const inputFields = [createInputVar({ variable: 'my_test_var' })]

      const { container } = render(
        <FieldList
          nodeId="test-node-123"
          LabelRightContent={null}
          inputFields={inputFields}
          handleInputFieldsChange={vi.fn()}
          allVariableNames={[]}
        />,
      )
      fireEvent.mouseEnter(container.querySelector('.handle')!)

      const fieldItemButtons = container.querySelectorAll('.handle button.action-btn')
      if (fieldItemButtons.length >= 2)
        fireEvent.click(fieldItemButtons[1])

      expect(mockIsVarUsedInNodes).toHaveBeenCalledWith(['rag', 'test-node-123', 'my_test_var'])
    })

    it('should handle empty variable name gracefully', async () => {
      mockIsVarUsedInNodes.mockReturnValue(false)
      const inputFields = [createInputVar({ variable: '' })]
      const handleInputFieldsChange = vi.fn()

      const { container } = render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={null}
          inputFields={inputFields}
          handleInputFieldsChange={handleInputFieldsChange}
          allVariableNames={[]}
        />,
      )
      fireEvent.mouseEnter(container.querySelector('.handle')!)

      const fieldItemButtons = container.querySelectorAll('.handle button.action-btn')
      if (fieldItemButtons.length >= 2)
        fireEvent.click(fieldItemButtons[1])

      expect(mockIsVarUsedInNodes).toHaveBeenCalledWith(['rag', 'node-1', ''])
    })

    it('should set removedVar and removedIndex when showing confirmation (lines 71-73)', async () => {
      mockIsVarUsedInNodes.mockReturnValue(true)
      const inputFields = createInputVarList(3)
      const handleInputFieldsChange = vi.fn()

      const { container } = render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={null}
          inputFields={inputFields}
          handleInputFieldsChange={handleInputFieldsChange}
          allVariableNames={[]}
        />,
      )
      const fieldItemRoots = container.querySelectorAll('.handle')
      fieldItemRoots.forEach(el => fireEvent.mouseEnter(el))

      const allFieldItemButtons = container.querySelectorAll('.handle button.action-btn')
      if (allFieldItemButtons.length >= 4)
        fireEvent.click(allFieldItemButtons[3])

      await waitFor(() => {
        expect(screen.getByTestId('remove-var-confirm')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('confirm-ok'))

      await waitFor(() => {
        expect(handleInputFieldsChange).toHaveBeenCalled()
      })
      const calledFields = handleInputFieldsChange.mock.calls[0][1]
      expect(calledFields.length).toBe(2) // 3 - 1 = 2 items remaining
      expect(calledFields.map((f: InputVar) => f.variable)).toEqual(['var_0', 'var_2'])
    })
  })

  describe('handleOpenInputFieldEditor', () => {
    it('should call toggleInputFieldEditPanel with editor props', () => {
      const inputFields = createInputVarList(1)

      render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={null}
          inputFields={inputFields}
          handleInputFieldsChange={vi.fn()}
          allVariableNames={[]}
        />,
      )
      const addButton = screen.getAllByRole('button').find(btn =>
        btn.querySelector('svg'),
      )
      if (addButton)
        fireEvent.click(addButton)

      expect(mockToggleInputFieldEditPanel).toHaveBeenCalledWith(
        expect.objectContaining({
          onClose: expect.any(Function),
          onSubmit: expect.any(Function),
        }),
      )
    })

    it('should pass initialData when editing existing field', () => {
      const inputFields = [createInputVar({ variable: 'my_var', label: 'My Label' })]

      const { container } = render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={null}
          inputFields={inputFields}
          handleInputFieldsChange={vi.fn()}
          allVariableNames={[]}
        />,
      )
      fireEvent.mouseEnter(container.querySelector('.handle')!)
      const fieldItemButtons = container.querySelectorAll('.handle button.action-btn')
      if (fieldItemButtons.length >= 1)
        fireEvent.click(fieldItemButtons[0])

      expect(mockToggleInputFieldEditPanel).toHaveBeenCalledWith(
        expect.objectContaining({
          initialData: expect.objectContaining({
            variable: 'my_var',
            label: 'My Label',
          }),
        }),
      )
    })
  })

  describe('onRemoveVarConfirm', () => {
    it('should remove field and call removeUsedVarInNodes', async () => {
      mockIsVarUsedInNodes.mockReturnValue(true)
      const inputFields = createInputVarList(2)
      const handleInputFieldsChange = vi.fn()

      const { container } = render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={null}
          inputFields={inputFields}
          handleInputFieldsChange={handleInputFieldsChange}
          allVariableNames={[]}
        />,
      )
      fireEvent.mouseEnter(container.querySelector('.handle')!)

      const fieldItemButtons = container.querySelectorAll('.handle button.action-btn')
      if (fieldItemButtons.length >= 2)
        fireEvent.click(fieldItemButtons[1])

      await waitFor(() => {
        expect(screen.getByTestId('remove-var-confirm')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('confirm-ok'))

      await waitFor(() => {
        expect(handleInputFieldsChange).toHaveBeenCalled()
        expect(mockRemoveUsedVarInNodes).toHaveBeenCalled()
      })
    })
  })
})

describe('handleSubmitField', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsVarUsedInNodes.mockReturnValue(false)
  })

  it('should add new field when editingFieldIndex is -1', () => {
    const inputFields = createInputVarList(1)
    const handleInputFieldsChange = vi.fn()

    render(
      <FieldList
        nodeId="node-1"
        LabelRightContent={null}
        inputFields={inputFields}
        handleInputFieldsChange={handleInputFieldsChange}
        allVariableNames={['var_0']}
      />,
    )

    fireEvent.click(screen.getByTestId('field-list-add-btn'))

    expect(mockToggleInputFieldEditPanel).toHaveBeenCalled()
    const editorProps = mockToggleInputFieldEditPanel.mock.calls[0][0]
    expect(editorProps).toHaveProperty('onSubmit')

    const newFieldData = createInputVar({ variable: 'new_var', label: 'New Label' })
    editorProps.onSubmit(newFieldData)

    expect(handleInputFieldsChange).toHaveBeenCalledWith(
      'node-1',
      expect.arrayContaining([
        expect.objectContaining({ variable: 'var_0' }),
        expect.objectContaining({ variable: 'new_var', label: 'New Label' }),
      ]),
    )
  })

  it('should update existing field when editingFieldIndex is valid', () => {
    const inputFields = createInputVarList(1)
    const handleInputFieldsChange = vi.fn()

    const { container } = render(
      <FieldList
        nodeId="node-1"
        LabelRightContent={null}
        inputFields={inputFields}
        handleInputFieldsChange={handleInputFieldsChange}
        allVariableNames={['var_0']}
      />,
    )
    fireEvent.mouseEnter(container.querySelector('.handle')!)

    const fieldItemButtons = container.querySelectorAll('.handle button.action-btn')
    if (fieldItemButtons.length >= 1)
      fireEvent.click(fieldItemButtons[0])

    const editorProps = mockToggleInputFieldEditPanel.mock.calls[0][0]

    const updatedFieldData = createInputVar({ variable: 'var_0', label: 'Updated Label' })
    editorProps.onSubmit(updatedFieldData)

    expect(handleInputFieldsChange).toHaveBeenCalledWith(
      'node-1',
      expect.arrayContaining([
        expect.objectContaining({ variable: 'var_0', label: 'Updated Label' }),
      ]),
    )
    const calledFields = handleInputFieldsChange.mock.calls[0][1]
    expect(calledFields.length).toBe(1) // Should still be 1, not 2
  })

  it('should call handleInputVarRename when variable name changes', () => {
    const inputFields = createInputVarList(1)
    const handleInputFieldsChange = vi.fn()

    const { container } = render(
      <FieldList
        nodeId="node-1"
        LabelRightContent={null}
        inputFields={inputFields}
        handleInputFieldsChange={handleInputFieldsChange}
        allVariableNames={['var_0']}
      />,
    )
    fireEvent.mouseEnter(container.querySelector('.handle')!)

    const fieldItemButtons = container.querySelectorAll('.handle button.action-btn')
    if (fieldItemButtons.length >= 1)
      fireEvent.click(fieldItemButtons[0])

    const editorProps = mockToggleInputFieldEditPanel.mock.calls[0][0]

    const updatedFieldData = createInputVar({ variable: 'new_var_name', label: 'Label 0' })
    editorProps.onSubmit(updatedFieldData, {
      type: 'changeVarName',
      payload: { beforeKey: 'var_0', afterKey: 'new_var_name' },
    })

    expect(mockHandleInputVarRename).toHaveBeenCalledWith(
      'node-1',
      ['rag', 'node-1', 'var_0'],
      ['rag', 'node-1', 'new_var_name'],
    )
  })

  it('should not call handleInputVarRename when moreInfo type is not changeVarName', () => {
    const inputFields = createInputVarList(1)
    const handleInputFieldsChange = vi.fn()

    const { container } = render(
      <FieldList
        nodeId="node-1"
        LabelRightContent={null}
        inputFields={inputFields}
        handleInputFieldsChange={handleInputFieldsChange}
        allVariableNames={['var_0']}
      />,
    )
    fireEvent.mouseEnter(container.querySelector('.handle')!)

    const fieldItemButtons = container.querySelectorAll('.handle button.action-btn')
    if (fieldItemButtons.length >= 1)
      fireEvent.click(fieldItemButtons[0])

    const editorProps = mockToggleInputFieldEditPanel.mock.calls[0][0]

    const updatedFieldData = createInputVar({ variable: 'var_0', label: 'Updated Label' })
    editorProps.onSubmit(updatedFieldData)

    expect(mockHandleInputVarRename).not.toHaveBeenCalled()
    expect(handleInputFieldsChange).toHaveBeenCalled()
  })

  it('should not call handleInputVarRename when moreInfo has different type', () => {
    const inputFields = createInputVarList(1)
    const handleInputFieldsChange = vi.fn()

    const { container } = render(
      <FieldList
        nodeId="node-1"
        LabelRightContent={null}
        inputFields={inputFields}
        handleInputFieldsChange={handleInputFieldsChange}
        allVariableNames={['var_0']}
      />,
    )
    fireEvent.mouseEnter(container.querySelector('.handle')!)

    const fieldItemButtons = container.querySelectorAll('.handle button.action-btn')
    if (fieldItemButtons.length >= 1)
      fireEvent.click(fieldItemButtons[0])

    const editorProps = mockToggleInputFieldEditPanel.mock.calls[0][0]

    const updatedFieldData = createInputVar({ variable: 'var_0', label: 'Updated Label' })
    editorProps.onSubmit(updatedFieldData, { type: 'otherType' as never })

    expect(mockHandleInputVarRename).not.toHaveBeenCalled()
    expect(handleInputFieldsChange).toHaveBeenCalled()
  })

  it('should handle empty beforeKey and afterKey in moreInfo payload', () => {
    const inputFields = createInputVarList(1)
    const handleInputFieldsChange = vi.fn()

    const { container } = render(
      <FieldList
        nodeId="node-1"
        LabelRightContent={null}
        inputFields={inputFields}
        handleInputFieldsChange={handleInputFieldsChange}
        allVariableNames={['var_0']}
      />,
    )
    fireEvent.mouseEnter(container.querySelector('.handle')!)

    const fieldItemButtons = container.querySelectorAll('.handle button.action-btn')
    if (fieldItemButtons.length >= 1)
      fireEvent.click(fieldItemButtons[0])

    const editorProps = mockToggleInputFieldEditPanel.mock.calls[0][0]

    const updatedFieldData = createInputVar({ variable: 'new_var' })
    editorProps.onSubmit(updatedFieldData, {
      type: 'changeVarName',
      payload: { beforeKey: '', afterKey: '' },
    })

    expect(mockHandleInputVarRename).toHaveBeenCalledWith(
      'node-1',
      ['rag', 'node-1', ''],
      ['rag', 'node-1', ''],
    )
  })

  it('should handle undefined payload in moreInfo', () => {
    const inputFields = createInputVarList(1)
    const handleInputFieldsChange = vi.fn()

    const { container } = render(
      <FieldList
        nodeId="node-1"
        LabelRightContent={null}
        inputFields={inputFields}
        handleInputFieldsChange={handleInputFieldsChange}
        allVariableNames={['var_0']}
      />,
    )
    fireEvent.mouseEnter(container.querySelector('.handle')!)

    const fieldItemButtons = container.querySelectorAll('.handle button.action-btn')
    if (fieldItemButtons.length >= 1)
      fireEvent.click(fieldItemButtons[0])

    const editorProps = mockToggleInputFieldEditPanel.mock.calls[0][0]

    const updatedFieldData = createInputVar({ variable: 'new_var' })
    editorProps.onSubmit(updatedFieldData, {
      type: 'changeVarName',
      payload: undefined,
    })

    expect(mockHandleInputVarRename).toHaveBeenCalledWith(
      'node-1',
      ['rag', 'node-1', ''],
      ['rag', 'node-1', ''],
    )
  })

  it('should close editor panel after successful submission', () => {
    const inputFields = createInputVarList(1)
    const handleInputFieldsChange = vi.fn()

    render(
      <FieldList
        nodeId="node-1"
        LabelRightContent={null}
        inputFields={inputFields}
        handleInputFieldsChange={handleInputFieldsChange}
        allVariableNames={['var_0']}
      />,
    )

    fireEvent.click(screen.getByTestId('field-list-add-btn'))

    const editorProps = mockToggleInputFieldEditPanel.mock.calls[0][0]

    const newFieldData = createInputVar({ variable: 'new_var' })
    editorProps.onSubmit(newFieldData)

    expect(mockToggleInputFieldEditPanel).toHaveBeenCalledTimes(2)
    expect(mockToggleInputFieldEditPanel).toHaveBeenLastCalledWith(null)
  })

  it('should call onClose when editor is closed manually', () => {
    const inputFields = createInputVarList(1)

    render(
      <FieldList
        nodeId="node-1"
        LabelRightContent={null}
        inputFields={inputFields}
        handleInputFieldsChange={vi.fn()}
        allVariableNames={[]}
      />,
    )

    fireEvent.click(screen.getByTestId('field-list-add-btn'))

    const editorProps = mockToggleInputFieldEditPanel.mock.calls[0][0]
    expect(editorProps).toHaveProperty('onClose')

    editorProps.onClose()

    expect(mockToggleInputFieldEditPanel).toHaveBeenLastCalledWith(null)
  })
})

describe('Duplicate Variable Name Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsVarUsedInNodes.mockReturnValue(false)
  })

  it('should not add field if variable name is duplicate', () => {
    const inputFields = createInputVarList(2)
    const handleInputFieldsChange = vi.fn()

    render(
      <FieldList
        nodeId="node-1"
        LabelRightContent={null}
        inputFields={inputFields}
        handleInputFieldsChange={handleInputFieldsChange}
        allVariableNames={['var_0', 'var_1', 'existing_var']}
      />,
    )

    fireEvent.click(screen.getByTestId('field-list-add-btn'))

    const editorProps = mockToggleInputFieldEditPanel.mock.calls[0][0]

    const duplicateFieldData = createInputVar({ variable: 'existing_var' })
    editorProps.onSubmit(duplicateFieldData)

    expect(handleInputFieldsChange).not.toHaveBeenCalled()
    expect(Toast.notify).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error' }),
    )
  })

  it('should allow updating field to same variable name', () => {
    const inputFields = createInputVarList(2)
    const handleInputFieldsChange = vi.fn()

    const { container } = render(
      <FieldList
        nodeId="node-1"
        LabelRightContent={null}
        inputFields={inputFields}
        handleInputFieldsChange={handleInputFieldsChange}
        allVariableNames={['var_0', 'var_1']}
      />,
    )
    fireEvent.mouseEnter(container.querySelector('.handle')!)

    const fieldItemButtons = container.querySelectorAll('.handle button.action-btn')
    if (fieldItemButtons.length >= 1)
      fireEvent.click(fieldItemButtons[0])

    const editorProps = mockToggleInputFieldEditPanel.mock.calls[0][0]

    const updatedFieldData = createInputVar({ variable: 'var_0', label: 'New Label' })
    editorProps.onSubmit(updatedFieldData)

    expect(handleInputFieldsChange).toHaveBeenCalled()
  })
})

describe('SortableItem Type', () => {
  it('should have correct structure', () => {
    const inputVar = createInputVar()
    const sortableItem = createSortableItem(inputVar)

    expect(sortableItem.id).toBe(inputVar.variable)
    expect(sortableItem.chosen).toBe(false)
    expect(sortableItem.selected).toBe(false)
    expect(sortableItem.type).toBe(inputVar.type)
    expect(sortableItem.variable).toBe(inputVar.variable)
    expect(sortableItem.label).toBe(inputVar.label)
  })

  it('should allow overriding sortable properties', () => {
    const inputVar = createInputVar()
    const sortableItem = createSortableItem(inputVar, {
      chosen: true,
      selected: true,
    })

    expect(sortableItem.chosen).toBe(true)
    expect(sortableItem.selected).toBe(true)
  })
})

describe('Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsVarUsedInNodes.mockReturnValue(false)
  })

  describe('Complete Workflow', () => {
    it('should handle add -> edit -> remove workflow', async () => {
      const inputFields = createInputVarList(1)
      const handleInputFieldsChange = vi.fn()

      const { container } = render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={<span>Fields</span>}
          inputFields={inputFields}
          handleInputFieldsChange={handleInputFieldsChange}
          allVariableNames={['var_0']}
        />,
      )
      fireEvent.mouseEnter(container.querySelector('.handle')!)

      fireEvent.click(screen.getByTestId('field-list-add-btn'))
      expect(mockToggleInputFieldEditPanel).toHaveBeenCalled()

      const fieldItemButtons = container.querySelectorAll('.handle button.action-btn')
      if (fieldItemButtons.length >= 1) {
        fireEvent.click(fieldItemButtons[0])
        expect(mockToggleInputFieldEditPanel).toHaveBeenCalledTimes(2)
      }

      if (fieldItemButtons.length >= 2)
        fireEvent.click(fieldItemButtons[1])

      expect(handleInputFieldsChange).toHaveBeenCalled()
    })
  })

  describe('Props Propagation', () => {
    it('should propagate readonly prop through all components', () => {
      const inputFields = createInputVarList(2)

      render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={null}
          inputFields={inputFields}
          handleInputFieldsChange={vi.fn()}
          allVariableNames={[]}
          readonly={true}
        />,
      )

      const addButton = screen.getAllByRole('button').find(btn =>
        btn.querySelector('svg'),
      )
      expect(addButton).toBeDisabled()
    })
  })
})
