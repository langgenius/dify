import type { SortableItem } from './types'
import type { InputVar } from '@/models/pipeline'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { PipelineInputVarType } from '@/models/pipeline'
import FieldItem from './field-item'
import FieldListContainer from './field-list-container'
import FieldList from './index'

// ============================================================================
// Mock External Dependencies
// ============================================================================

// Mock ahooks useHover
let mockIsHovering = false
const getMockIsHovering = () => mockIsHovering

vi.mock('ahooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ahooks')>()
  return {
    ...actual,
    useHover: () => getMockIsHovering(),
  }
})

// Mock react-sortablejs
vi.mock('react-sortablejs', () => ({
  ReactSortable: ({ children, list, setList, disabled, className }: {
    children: React.ReactNode
    list: SortableItem[]
    setList: (newList: SortableItem[]) => void
    disabled?: boolean
    className?: string
  }) => (
    <div
      data-testid="sortable-container"
      data-disabled={disabled}
      className={className}
    >
      {children}
      <button
        data-testid="trigger-sort"
        onClick={() => {
          if (!disabled && list.length > 1) {
            // Simulate reorder: swap first two items
            const newList = [...list]
            const temp = newList[0]
            newList[0] = newList[1]
            newList[1] = temp
            setList(newList)
          }
        }}
      >
        Trigger Sort
      </button>
      <button
        data-testid="trigger-same-sort"
        onClick={() => {
          // Trigger setList with same list (no actual change)
          setList([...list])
        }}
      >
        Trigger Same Sort
      </button>
    </div>
  ),
}))

// Mock usePipeline hook
const mockHandleInputVarRename = vi.fn()
const mockIsVarUsedInNodes = vi.fn(() => false)
const mockRemoveUsedVarInNodes = vi.fn()

vi.mock('../../../../hooks/use-pipeline', () => ({
  usePipeline: () => ({
    handleInputVarRename: mockHandleInputVarRename,
    isVarUsedInNodes: mockIsVarUsedInNodes,
    removeUsedVarInNodes: mockRemoveUsedVarInNodes,
  }),
}))

// Mock useInputFieldPanel hook
const mockToggleInputFieldEditPanel = vi.fn()

vi.mock('@/app/components/rag-pipeline/hooks', () => ({
  useInputFieldPanel: () => ({
    toggleInputFieldEditPanel: mockToggleInputFieldEditPanel,
  }),
}))

// Mock Toast
vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: vi.fn(),
  },
}))

// Mock RemoveEffectVarConfirm
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

// ============================================================================
// Test Data Factories
// ============================================================================

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

// ============================================================================
// FieldItem Component Tests
// ============================================================================

describe('FieldItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsHovering = false
  })

  // -------------------------------------------------------------------------
  // Rendering Tests
  // -------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render field item with variable name', () => {
      // Arrange
      const payload = createInputVar({ variable: 'my_field' })

      // Act
      render(
        <FieldItem
          payload={payload}
          index={0}
          onClickEdit={vi.fn()}
          onRemove={vi.fn()}
        />,
      )

      // Assert
      expect(screen.getByText('my_field')).toBeInTheDocument()
    })

    it('should render field item with label when provided', () => {
      // Arrange
      const payload = createInputVar({ variable: 'field', label: 'Field Label' })

      // Act
      render(
        <FieldItem
          payload={payload}
          index={0}
          onClickEdit={vi.fn()}
          onRemove={vi.fn()}
        />,
      )

      // Assert
      expect(screen.getByText('Field Label')).toBeInTheDocument()
    })

    it('should not render label when empty', () => {
      // Arrange
      const payload = createInputVar({ variable: 'field', label: '' })

      // Act
      render(
        <FieldItem
          payload={payload}
          index={0}
          onClickEdit={vi.fn()}
          onRemove={vi.fn()}
        />,
      )

      // Assert
      expect(screen.queryByText('·')).not.toBeInTheDocument()
    })

    it('should render required badge when not hovering and required is true', () => {
      // Arrange
      mockIsHovering = false
      const payload = createInputVar({ required: true })

      // Act
      render(
        <FieldItem
          payload={payload}
          index={0}
          onClickEdit={vi.fn()}
          onRemove={vi.fn()}
        />,
      )

      // Assert
      expect(screen.getByText(/required/i)).toBeInTheDocument()
    })

    it('should not render required badge when required is false', () => {
      // Arrange
      mockIsHovering = false
      const payload = createInputVar({ required: false })

      // Act
      render(
        <FieldItem
          payload={payload}
          index={0}
          onClickEdit={vi.fn()}
          onRemove={vi.fn()}
        />,
      )

      // Assert
      expect(screen.queryByText(/required/i)).not.toBeInTheDocument()
    })

    it('should render InputField icon when not hovering', () => {
      // Arrange
      mockIsHovering = false
      const payload = createInputVar()

      // Act
      const { container } = render(
        <FieldItem
          payload={payload}
          index={0}
          onClickEdit={vi.fn()}
          onRemove={vi.fn()}
        />,
      )

      // Assert - InputField icon should be present (not RiDraggable)
      const icons = container.querySelectorAll('svg')
      expect(icons.length).toBeGreaterThan(0)
    })

    it('should render drag icon when hovering and not readonly', () => {
      // Arrange
      mockIsHovering = true
      const payload = createInputVar()

      // Act
      const { container } = render(
        <FieldItem
          payload={payload}
          index={0}
          onClickEdit={vi.fn()}
          onRemove={vi.fn()}
          readonly={false}
        />,
      )

      // Assert - RiDraggable icon should be present
      const icons = container.querySelectorAll('svg')
      expect(icons.length).toBeGreaterThan(0)
    })

    it('should render edit and delete buttons when hovering and not readonly', () => {
      // Arrange
      mockIsHovering = true
      const payload = createInputVar()

      // Act
      render(
        <FieldItem
          payload={payload}
          index={0}
          onClickEdit={vi.fn()}
          onRemove={vi.fn()}
          readonly={false}
        />,
      )

      // Assert
      const buttons = screen.getAllByRole('button')
      expect(buttons.length).toBe(2) // Edit and Delete buttons
    })

    it('should not render edit and delete buttons when readonly', () => {
      // Arrange
      mockIsHovering = true
      const payload = createInputVar()

      // Act
      render(
        <FieldItem
          payload={payload}
          index={0}
          onClickEdit={vi.fn()}
          onRemove={vi.fn()}
          readonly={true}
        />,
      )

      // Assert
      const buttons = screen.queryAllByRole('button')
      expect(buttons.length).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // User Interaction Tests
  // -------------------------------------------------------------------------
  describe('User Interactions', () => {
    it('should call onClickEdit with variable when edit button is clicked', () => {
      // Arrange
      mockIsHovering = true
      const onClickEdit = vi.fn()
      const payload = createInputVar({ variable: 'test_var' })

      // Act
      render(
        <FieldItem
          payload={payload}
          index={0}
          onClickEdit={onClickEdit}
          onRemove={vi.fn()}
        />,
      )
      const buttons = screen.getAllByRole('button')
      fireEvent.click(buttons[0]) // Edit button

      // Assert
      expect(onClickEdit).toHaveBeenCalledWith('test_var')
    })

    it('should call onRemove with index when delete button is clicked', () => {
      // Arrange
      mockIsHovering = true
      const onRemove = vi.fn()
      const payload = createInputVar()

      // Act
      render(
        <FieldItem
          payload={payload}
          index={5}
          onClickEdit={vi.fn()}
          onRemove={onRemove}
        />,
      )
      const buttons = screen.getAllByRole('button')
      fireEvent.click(buttons[1]) // Delete button

      // Assert
      expect(onRemove).toHaveBeenCalledWith(5)
    })

    it('should not call onClickEdit when readonly', () => {
      // Arrange
      mockIsHovering = true
      const onClickEdit = vi.fn()
      const payload = createInputVar()

      // Render without readonly to get buttons, then check behavior
      const { rerender } = render(
        <FieldItem
          payload={payload}
          index={0}
          onClickEdit={onClickEdit}
          onRemove={vi.fn()}
          readonly={false}
        />,
      )

      // Re-render with readonly but buttons still exist from previous state check
      rerender(
        <FieldItem
          payload={payload}
          index={0}
          onClickEdit={onClickEdit}
          onRemove={vi.fn()}
          readonly={true}
        />,
      )

      // Assert - no buttons should be rendered when readonly
      expect(screen.queryAllByRole('button').length).toBe(0)
    })

    it('should stop event propagation when edit button is clicked', () => {
      // Arrange
      mockIsHovering = true
      const onClickEdit = vi.fn()
      const parentClick = vi.fn()
      const payload = createInputVar()

      // Act
      render(
        <div onClick={parentClick}>
          <FieldItem
            payload={payload}
            index={0}
            onClickEdit={onClickEdit}
            onRemove={vi.fn()}
          />
        </div>,
      )
      const buttons = screen.getAllByRole('button')
      fireEvent.click(buttons[0])

      // Assert - parent click should not be called due to stopPropagation
      expect(onClickEdit).toHaveBeenCalled()
      expect(parentClick).not.toHaveBeenCalled()
    })

    it('should stop event propagation when delete button is clicked', () => {
      // Arrange
      mockIsHovering = true
      const onRemove = vi.fn()
      const parentClick = vi.fn()
      const payload = createInputVar()

      // Act
      render(
        <div onClick={parentClick}>
          <FieldItem
            payload={payload}
            index={0}
            onClickEdit={vi.fn()}
            onRemove={onRemove}
          />
        </div>,
      )
      const buttons = screen.getAllByRole('button')
      fireEvent.click(buttons[1])

      // Assert
      expect(onRemove).toHaveBeenCalled()
      expect(parentClick).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // Callback Stability Tests
  // -------------------------------------------------------------------------
  describe('Callback Stability', () => {
    it('should maintain stable handleOnClickEdit when props dont change', () => {
      // Arrange
      mockIsHovering = true
      const onClickEdit = vi.fn()
      const payload = createInputVar()

      // Act
      const { rerender } = render(
        <FieldItem
          payload={payload}
          index={0}
          onClickEdit={onClickEdit}
          onRemove={vi.fn()}
        />,
      )
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
      const buttonsAfterRerender = screen.getAllByRole('button')
      fireEvent.click(buttonsAfterRerender[0])

      // Assert
      expect(onClickEdit).toHaveBeenCalledTimes(2)
    })
  })

  // -------------------------------------------------------------------------
  // Edge Cases Tests
  // -------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle very long variable names with truncation', () => {
      // Arrange
      const longVariable = 'a'.repeat(200)
      const payload = createInputVar({ variable: longVariable })

      // Act
      render(
        <FieldItem
          payload={payload}
          index={0}
          onClickEdit={vi.fn()}
          onRemove={vi.fn()}
        />,
      )

      // Assert
      const varElement = screen.getByTitle(longVariable)
      expect(varElement).toHaveClass('truncate')
    })

    it('should handle very long label names with truncation', () => {
      // Arrange
      const longLabel = 'b'.repeat(200)
      const payload = createInputVar({ label: longLabel })

      // Act
      render(
        <FieldItem
          payload={payload}
          index={0}
          onClickEdit={vi.fn()}
          onRemove={vi.fn()}
        />,
      )

      // Assert
      const labelElement = screen.getByTitle(longLabel)
      expect(labelElement).toHaveClass('truncate')
    })

    it('should handle special characters in variable and label', () => {
      // Arrange
      const payload = createInputVar({
        variable: '<test>&"var\'',
        label: '<label>&"test\'',
      })

      // Act
      render(
        <FieldItem
          payload={payload}
          index={0}
          onClickEdit={vi.fn()}
          onRemove={vi.fn()}
        />,
      )

      // Assert
      expect(screen.getByText('<test>&"var\'')).toBeInTheDocument()
      expect(screen.getByText('<label>&"test\'')).toBeInTheDocument()
    })

    it('should handle unicode characters', () => {
      // Arrange
      const payload = createInputVar({
        variable: '变量_🎉',
        label: '标签_😀',
      })

      // Act
      render(
        <FieldItem
          payload={payload}
          index={0}
          onClickEdit={vi.fn()}
          onRemove={vi.fn()}
        />,
      )

      // Assert
      expect(screen.getByText('变量_🎉')).toBeInTheDocument()
      expect(screen.getByText('标签_😀')).toBeInTheDocument()
    })

    it('should render different input types correctly', () => {
      // Arrange
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

        // Act
        const { unmount } = render(
          <FieldItem
            payload={payload}
            index={0}
            onClickEdit={vi.fn()}
            onRemove={vi.fn()}
          />,
        )

        // Assert
        expect(screen.getByText('test_variable')).toBeInTheDocument()
        unmount()
      })
    })
  })

  // -------------------------------------------------------------------------
  // Memoization Tests
  // -------------------------------------------------------------------------
  describe('Memoization', () => {
    it('should be memoized with React.memo', () => {
      // Arrange
      const payload = createInputVar()
      const onClickEdit = vi.fn()
      const onRemove = vi.fn()

      // Act
      const { rerender } = render(
        <FieldItem
          payload={payload}
          index={0}
          onClickEdit={onClickEdit}
          onRemove={onRemove}
        />,
      )

      // Rerender with same props
      rerender(
        <FieldItem
          payload={payload}
          index={0}
          onClickEdit={onClickEdit}
          onRemove={onRemove}
        />,
      )

      // Assert - component should still render correctly
      expect(screen.getByText('test_variable')).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // Readonly Mode Behavior Tests
  // -------------------------------------------------------------------------
  describe('Readonly Mode Behavior', () => {
    it('should not render action buttons in readonly mode even when hovering', () => {
      // Arrange
      mockIsHovering = true
      const payload = createInputVar()

      // Act
      render(
        <FieldItem
          payload={payload}
          index={0}
          onClickEdit={vi.fn()}
          onRemove={vi.fn()}
          readonly={true}
        />,
      )

      // Assert - no action buttons should be rendered
      expect(screen.queryAllByRole('button')).toHaveLength(0)
    })

    it('should render type icon and required badge in readonly mode when hovering', () => {
      // Arrange
      mockIsHovering = true
      const payload = createInputVar({ required: true })

      // Act
      render(
        <FieldItem
          payload={payload}
          index={0}
          onClickEdit={vi.fn()}
          onRemove={vi.fn()}
          readonly={true}
        />,
      )

      // Assert - required badge should be visible instead of action buttons
      expect(screen.getByText(/required/i)).toBeInTheDocument()
    })

    it('should apply cursor-default class when readonly', () => {
      // Arrange
      const payload = createInputVar()

      // Act
      const { container } = render(
        <FieldItem
          payload={payload}
          index={0}
          onClickEdit={vi.fn()}
          onRemove={vi.fn()}
          readonly={true}
        />,
      )

      // Assert
      const fieldItem = container.firstChild as HTMLElement
      expect(fieldItem.className).toContain('cursor-default')
    })

    it('should apply cursor-all-scroll class when hovering and not readonly', () => {
      // Arrange
      mockIsHovering = true
      const payload = createInputVar()

      // Act
      const { container } = render(
        <FieldItem
          payload={payload}
          index={0}
          onClickEdit={vi.fn()}
          onRemove={vi.fn()}
          readonly={false}
        />,
      )

      // Assert
      const fieldItem = container.firstChild as HTMLElement
      expect(fieldItem.className).toContain('cursor-all-scroll')
    })
  })
})

// ============================================================================
// FieldListContainer Component Tests
// ============================================================================

describe('FieldListContainer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsHovering = false
  })

  // -------------------------------------------------------------------------
  // Rendering Tests
  // -------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render sortable container', () => {
      // Arrange
      const inputFields = createInputVarList(2)

      // Act
      render(
        <FieldListContainer
          inputFields={inputFields}
          onListSortChange={vi.fn()}
          onRemoveField={vi.fn()}
          onEditField={vi.fn()}
        />,
      )

      // Assert
      expect(screen.getByTestId('sortable-container')).toBeInTheDocument()
    })

    it('should render all field items', () => {
      // Arrange
      const inputFields = createInputVarList(3)

      // Act
      render(
        <FieldListContainer
          inputFields={inputFields}
          onListSortChange={vi.fn()}
          onRemoveField={vi.fn()}
          onEditField={vi.fn()}
        />,
      )

      // Assert
      expect(screen.getByText('var_0')).toBeInTheDocument()
      expect(screen.getByText('var_1')).toBeInTheDocument()
      expect(screen.getByText('var_2')).toBeInTheDocument()
    })

    it('should render empty list without errors', () => {
      // Act
      render(
        <FieldListContainer
          inputFields={[]}
          onListSortChange={vi.fn()}
          onRemoveField={vi.fn()}
          onEditField={vi.fn()}
        />,
      )

      // Assert
      expect(screen.getByTestId('sortable-container')).toBeInTheDocument()
    })

    it('should apply custom className', () => {
      // Arrange
      const inputFields = createInputVarList(1)

      // Act
      render(
        <FieldListContainer
          className="custom-class"
          inputFields={inputFields}
          onListSortChange={vi.fn()}
          onRemoveField={vi.fn()}
          onEditField={vi.fn()}
        />,
      )

      // Assert
      const container = screen.getByTestId('sortable-container')
      expect(container.className).toContain('custom-class')
    })

    it('should disable sorting when readonly is true', () => {
      // Arrange
      const inputFields = createInputVarList(2)

      // Act
      render(
        <FieldListContainer
          inputFields={inputFields}
          onListSortChange={vi.fn()}
          onRemoveField={vi.fn()}
          onEditField={vi.fn()}
          readonly={true}
        />,
      )

      // Assert
      const container = screen.getByTestId('sortable-container')
      expect(container.dataset.disabled).toBe('true')
    })
  })

  // -------------------------------------------------------------------------
  // User Interaction Tests
  // -------------------------------------------------------------------------
  describe('User Interactions', () => {
    it('should call onListSortChange when items are reordered', () => {
      // Arrange
      const inputFields = createInputVarList(2)
      const onListSortChange = vi.fn()

      // Act
      render(
        <FieldListContainer
          inputFields={inputFields}
          onListSortChange={onListSortChange}
          onRemoveField={vi.fn()}
          onEditField={vi.fn()}
        />,
      )
      fireEvent.click(screen.getByTestId('trigger-sort'))

      // Assert
      expect(onListSortChange).toHaveBeenCalled()
    })

    it('should not call onListSortChange when list hasnt changed', () => {
      // Arrange
      const inputFields = [createInputVar()]
      const onListSortChange = vi.fn()

      // Act
      render(
        <FieldListContainer
          inputFields={inputFields}
          onListSortChange={onListSortChange}
          onRemoveField={vi.fn()}
          onEditField={vi.fn()}
        />,
      )
      fireEvent.click(screen.getByTestId('trigger-sort'))

      // Assert - with only one item, no reorder happens
      expect(onListSortChange).not.toHaveBeenCalled()
    })

    it('should not call onListSortChange when disabled', () => {
      // Arrange
      const inputFields = createInputVarList(2)
      const onListSortChange = vi.fn()

      // Act
      render(
        <FieldListContainer
          inputFields={inputFields}
          onListSortChange={onListSortChange}
          onRemoveField={vi.fn()}
          onEditField={vi.fn()}
          readonly={true}
        />,
      )
      fireEvent.click(screen.getByTestId('trigger-sort'))

      // Assert
      expect(onListSortChange).not.toHaveBeenCalled()
    })

    it('should not call onListSortChange when list order is unchanged (isEqual check)', () => {
      // Arrange - This tests line 42 in field-list-container.tsx
      const inputFields = createInputVarList(2)
      const onListSortChange = vi.fn()

      // Act
      render(
        <FieldListContainer
          inputFields={inputFields}
          onListSortChange={onListSortChange}
          onRemoveField={vi.fn()}
          onEditField={vi.fn()}
        />,
      )
      // Trigger same sort - passes same list to setList
      fireEvent.click(screen.getByTestId('trigger-same-sort'))

      // Assert - onListSortChange should NOT be called due to isEqual check
      expect(onListSortChange).not.toHaveBeenCalled()
    })

    it('should pass onEditField to FieldItem', () => {
      // Arrange
      mockIsHovering = true
      const inputFields = createInputVarList(1)
      const onEditField = vi.fn()

      // Act
      render(
        <FieldListContainer
          inputFields={inputFields}
          onListSortChange={vi.fn()}
          onRemoveField={vi.fn()}
          onEditField={onEditField}
        />,
      )
      const buttons = screen.getAllByRole('button')
      fireEvent.click(buttons[0]) // Edit button

      // Assert
      expect(onEditField).toHaveBeenCalledWith('var_0')
    })

    it('should pass onRemoveField to FieldItem', () => {
      // Arrange
      mockIsHovering = true
      const inputFields = createInputVarList(1)
      const onRemoveField = vi.fn()

      // Act
      render(
        <FieldListContainer
          inputFields={inputFields}
          onListSortChange={vi.fn()}
          onRemoveField={onRemoveField}
          onEditField={vi.fn()}
        />,
      )
      const buttons = screen.getAllByRole('button')
      fireEvent.click(buttons[1]) // Delete button

      // Assert
      expect(onRemoveField).toHaveBeenCalledWith(0)
    })
  })

  // -------------------------------------------------------------------------
  // List Conversion Tests
  // -------------------------------------------------------------------------
  describe('List Conversion', () => {
    it('should convert InputVar[] to SortableItem[]', () => {
      // Arrange
      const inputFields = [
        createInputVar({ variable: 'var1' }),
        createInputVar({ variable: 'var2' }),
      ]
      const onListSortChange = vi.fn()

      // Act
      render(
        <FieldListContainer
          inputFields={inputFields}
          onListSortChange={onListSortChange}
          onRemoveField={vi.fn()}
          onEditField={vi.fn()}
        />,
      )
      fireEvent.click(screen.getByTestId('trigger-sort'))

      // Assert - onListSortChange should receive SortableItem[]
      expect(onListSortChange).toHaveBeenCalled()
      const calledWith = onListSortChange.mock.calls[0][0]
      expect(calledWith[0]).toHaveProperty('id')
      expect(calledWith[0]).toHaveProperty('chosen')
      expect(calledWith[0]).toHaveProperty('selected')
    })
  })

  // -------------------------------------------------------------------------
  // Memoization Tests
  // -------------------------------------------------------------------------
  describe('Memoization', () => {
    it('should memoize list transformation', () => {
      // Arrange
      const inputFields = createInputVarList(2)
      const onListSortChange = vi.fn()

      // Act
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

      // Assert - component should still render correctly
      expect(screen.getByText('var_0')).toBeInTheDocument()
    })

    it('should be memoized with React.memo', () => {
      // Arrange
      const inputFields = createInputVarList(1)

      // Act
      const { rerender } = render(
        <FieldListContainer
          inputFields={inputFields}
          onListSortChange={vi.fn()}
          onRemoveField={vi.fn()}
          onEditField={vi.fn()}
        />,
      )

      // Rerender with same props
      rerender(
        <FieldListContainer
          inputFields={inputFields}
          onListSortChange={vi.fn()}
          onRemoveField={vi.fn()}
          onEditField={vi.fn()}
        />,
      )

      // Assert
      expect(screen.getByText('var_0')).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // Edge Cases Tests
  // -------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle large list of items', () => {
      // Arrange
      const inputFields = createInputVarList(100)

      // Act
      render(
        <FieldListContainer
          inputFields={inputFields}
          onListSortChange={vi.fn()}
          onRemoveField={vi.fn()}
          onEditField={vi.fn()}
        />,
      )

      // Assert
      expect(screen.getByText('var_0')).toBeInTheDocument()
      expect(screen.getByText('var_99')).toBeInTheDocument()
    })

    it('should throw error when inputFields is undefined', () => {
      // This test documents that undefined inputFields will cause an error
      // In production, this should be prevented by TypeScript
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

// ============================================================================
// FieldList Component Tests (Integration)
// ============================================================================

describe('FieldList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsHovering = false
    mockIsVarUsedInNodes.mockReturnValue(false)
  })

  // -------------------------------------------------------------------------
  // Rendering Tests
  // -------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render FieldList component', () => {
      // Arrange
      const inputFields = createInputVarList(2)

      // Act
      render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={<span>Label Content</span>}
          inputFields={inputFields}
          handleInputFieldsChange={vi.fn()}
          allVariableNames={['var_0', 'var_1']}
        />,
      )

      // Assert
      expect(screen.getByText('Label Content')).toBeInTheDocument()
      expect(screen.getByText('var_0')).toBeInTheDocument()
    })

    it('should render add button', () => {
      // Arrange
      const inputFields = createInputVarList(1)

      // Act
      render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={null}
          inputFields={inputFields}
          handleInputFieldsChange={vi.fn()}
          allVariableNames={[]}
        />,
      )

      // Assert
      const addButton = screen.getAllByRole('button').find(btn =>
        btn.querySelector('svg'),
      )
      expect(addButton).toBeInTheDocument()
    })

    it('should disable add button when readonly', () => {
      // Arrange
      const inputFields = createInputVarList(1)

      // Act
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

      // Assert
      const addButton = screen.getAllByRole('button').find(btn =>
        btn.querySelector('svg'),
      )
      expect(addButton).toBeDisabled()
    })

    it('should apply custom labelClassName', () => {
      // Arrange
      const inputFields = createInputVarList(1)

      // Act
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

      // Assert
      const labelContainer = container.querySelector('.custom-label-class')
      expect(labelContainer).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // User Interaction Tests
  // -------------------------------------------------------------------------
  describe('User Interactions', () => {
    it('should open editor panel when add button is clicked', () => {
      // Arrange
      const inputFields = createInputVarList(1)

      // Act
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

      // Assert
      expect(mockToggleInputFieldEditPanel).toHaveBeenCalled()
    })

    it('should not open editor when readonly and add button clicked', () => {
      // Arrange
      const inputFields = createInputVarList(1)

      // Act
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

      // Assert - button is disabled so click shouldnt work
      expect(mockToggleInputFieldEditPanel).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // Callback Tests
  // -------------------------------------------------------------------------
  describe('Callback Handling', () => {
    it('should call handleInputFieldsChange with nodeId when fields change', () => {
      // Arrange
      const inputFields = createInputVarList(2)
      const handleInputFieldsChange = vi.fn()

      // Act
      render(
        <FieldList
          nodeId="node-123"
          LabelRightContent={null}
          inputFields={inputFields}
          handleInputFieldsChange={handleInputFieldsChange}
          allVariableNames={[]}
        />,
      )
      // Trigger sort to cause fields change
      fireEvent.click(screen.getByTestId('trigger-sort'))

      // Assert
      expect(handleInputFieldsChange).toHaveBeenCalledWith(
        'node-123',
        expect.any(Array),
      )
    })
  })

  // -------------------------------------------------------------------------
  // Remove Confirmation Tests
  // -------------------------------------------------------------------------
  describe('Remove Confirmation', () => {
    it('should show remove confirmation when variable is used in nodes', async () => {
      // Arrange
      mockIsVarUsedInNodes.mockReturnValue(true)
      mockIsHovering = true
      const inputFields = createInputVarList(1)

      // Act
      render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={null}
          inputFields={inputFields}
          handleInputFieldsChange={vi.fn()}
          allVariableNames={[]}
        />,
      )

      // Find all buttons in the sortable container (edit and delete)
      const sortableContainer = screen.getByTestId('sortable-container')
      const fieldItemButtons = sortableContainer.querySelectorAll('button.action-btn')
      // The second button should be the delete button
      if (fieldItemButtons.length >= 2)
        fireEvent.click(fieldItemButtons[1])

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('remove-var-confirm')).toBeInTheDocument()
      })
    })

    it('should hide remove confirmation when cancel is clicked', async () => {
      // Arrange
      mockIsVarUsedInNodes.mockReturnValue(true)
      mockIsHovering = true
      const inputFields = createInputVarList(1)

      // Act
      render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={null}
          inputFields={inputFields}
          handleInputFieldsChange={vi.fn()}
          allVariableNames={[]}
        />,
      )

      // Trigger remove - find delete button in sortable container
      const sortableContainer = screen.getByTestId('sortable-container')
      const fieldItemButtons = sortableContainer.querySelectorAll('button.action-btn')
      if (fieldItemButtons.length >= 2)
        fireEvent.click(fieldItemButtons[1])

      await waitFor(() => {
        expect(screen.getByTestId('remove-var-confirm')).toBeInTheDocument()
      })

      // Click cancel
      fireEvent.click(screen.getByTestId('confirm-cancel'))

      // Assert
      await waitFor(() => {
        expect(screen.queryByTestId('remove-var-confirm')).not.toBeInTheDocument()
      })
    })

    it('should remove field and call removeUsedVarInNodes when confirm is clicked', async () => {
      // Arrange
      mockIsVarUsedInNodes.mockReturnValue(true)
      mockIsHovering = true
      const inputFields = createInputVarList(1)
      const handleInputFieldsChange = vi.fn()

      // Act
      render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={null}
          inputFields={inputFields}
          handleInputFieldsChange={handleInputFieldsChange}
          allVariableNames={[]}
        />,
      )

      // Trigger remove - find delete button in sortable container
      const sortableContainer = screen.getByTestId('sortable-container')
      const fieldItemButtons = sortableContainer.querySelectorAll('button.action-btn')
      if (fieldItemButtons.length >= 2)
        fireEvent.click(fieldItemButtons[1])

      await waitFor(() => {
        expect(screen.getByTestId('remove-var-confirm')).toBeInTheDocument()
      })

      // Click confirm
      fireEvent.click(screen.getByTestId('confirm-ok'))

      // Assert
      await waitFor(() => {
        expect(handleInputFieldsChange).toHaveBeenCalled()
        expect(mockRemoveUsedVarInNodes).toHaveBeenCalled()
      })
    })

    it('should remove field directly when variable is not used in nodes', () => {
      // Arrange
      mockIsVarUsedInNodes.mockReturnValue(false)
      mockIsHovering = true
      const inputFields = createInputVarList(2)
      const handleInputFieldsChange = vi.fn()

      // Act
      render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={null}
          inputFields={inputFields}
          handleInputFieldsChange={handleInputFieldsChange}
          allVariableNames={[]}
        />,
      )

      // Find delete button in sortable container
      const sortableContainer = screen.getByTestId('sortable-container')
      const fieldItemButtons = sortableContainer.querySelectorAll('button.action-btn')
      if (fieldItemButtons.length >= 2)
        fireEvent.click(fieldItemButtons[1])

      // Assert - should not show confirmation
      expect(screen.queryByTestId('remove-var-confirm')).not.toBeInTheDocument()
      expect(handleInputFieldsChange).toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // Edge Cases Tests
  // -------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle empty inputFields', () => {
      // Act
      render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={null}
          inputFields={[]}
          handleInputFieldsChange={vi.fn()}
          allVariableNames={[]}
        />,
      )

      // Assert
      expect(screen.getByTestId('sortable-container')).toBeInTheDocument()
    })

    it('should handle null LabelRightContent', () => {
      // Act
      render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={null}
          inputFields={createInputVarList(1)}
          handleInputFieldsChange={vi.fn()}
          allVariableNames={[]}
        />,
      )

      // Assert - should render without errors
      expect(screen.getByText('var_0')).toBeInTheDocument()
    })

    it('should handle complex LabelRightContent', () => {
      // Arrange
      const complexContent = (
        <div data-testid="complex-content">
          <span>Part 1</span>
          <button>Part 2</button>
        </div>
      )

      // Act
      render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={complexContent}
          inputFields={createInputVarList(1)}
          handleInputFieldsChange={vi.fn()}
          allVariableNames={[]}
        />,
      )

      // Assert
      expect(screen.getByTestId('complex-content')).toBeInTheDocument()
      expect(screen.getByText('Part 1')).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // Memoization Tests
  // -------------------------------------------------------------------------
  describe('Memoization', () => {
    it('should be wrapped with React.memo', () => {
      // Arrange
      const inputFields = createInputVarList(1)
      const handleInputFieldsChange = vi.fn()

      // Act
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

      // Assert
      expect(screen.getByText('var_0')).toBeInTheDocument()
    })

    it('should maintain stable onInputFieldsChange callback', () => {
      // Arrange
      const inputFields = createInputVarList(2)
      const handleInputFieldsChange = vi.fn()

      // Act
      const { rerender } = render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={null}
          inputFields={inputFields}
          handleInputFieldsChange={handleInputFieldsChange}
          allVariableNames={[]}
        />,
      )

      fireEvent.click(screen.getByTestId('trigger-sort'))

      rerender(
        <FieldList
          nodeId="node-1"
          LabelRightContent={null}
          inputFields={inputFields}
          handleInputFieldsChange={handleInputFieldsChange}
          allVariableNames={[]}
        />,
      )

      fireEvent.click(screen.getByTestId('trigger-sort'))

      // Assert
      expect(handleInputFieldsChange).toHaveBeenCalledTimes(2)
    })
  })
})

// ============================================================================
// useFieldList Hook Tests
// ============================================================================

describe('useFieldList Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsVarUsedInNodes.mockReturnValue(false)
  })

  // -------------------------------------------------------------------------
  // Initialization Tests
  // -------------------------------------------------------------------------
  describe('Initialization', () => {
    it('should initialize with provided inputFields', () => {
      // Arrange
      const inputFields = createInputVarList(2)

      // Act
      render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={null}
          inputFields={inputFields}
          handleInputFieldsChange={vi.fn()}
          allVariableNames={[]}
        />,
      )

      // Assert
      expect(screen.getByText('var_0')).toBeInTheDocument()
      expect(screen.getByText('var_1')).toBeInTheDocument()
    })

    it('should initialize with empty inputFields', () => {
      // Act
      render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={null}
          inputFields={[]}
          handleInputFieldsChange={vi.fn()}
          allVariableNames={[]}
        />,
      )

      // Assert
      expect(screen.getByTestId('sortable-container')).toBeInTheDocument()
    })
  })

  // -------------------------------------------------------------------------
  // handleListSortChange Tests
  // -------------------------------------------------------------------------
  describe('handleListSortChange', () => {
    it('should update inputFields and call onInputFieldsChange', () => {
      // Arrange
      const inputFields = createInputVarList(2)
      const handleInputFieldsChange = vi.fn()

      // Act
      render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={null}
          inputFields={inputFields}
          handleInputFieldsChange={handleInputFieldsChange}
          allVariableNames={[]}
        />,
      )
      fireEvent.click(screen.getByTestId('trigger-sort'))

      // Assert
      expect(handleInputFieldsChange).toHaveBeenCalledWith(
        'node-1',
        expect.arrayContaining([
          expect.objectContaining({ variable: 'var_1' }),
          expect.objectContaining({ variable: 'var_0' }),
        ]),
      )
    })

    it('should strip sortable properties from list items', () => {
      // Arrange
      const inputFields = createInputVarList(2)
      const handleInputFieldsChange = vi.fn()

      // Act
      render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={null}
          inputFields={inputFields}
          handleInputFieldsChange={handleInputFieldsChange}
          allVariableNames={[]}
        />,
      )
      fireEvent.click(screen.getByTestId('trigger-sort'))

      // Assert
      const calledWith = handleInputFieldsChange.mock.calls[0][1]
      expect(calledWith[0]).not.toHaveProperty('id')
      expect(calledWith[0]).not.toHaveProperty('chosen')
      expect(calledWith[0]).not.toHaveProperty('selected')
    })
  })

  // -------------------------------------------------------------------------
  // handleRemoveField Tests
  // -------------------------------------------------------------------------
  describe('handleRemoveField', () => {
    it('should show confirmation when variable is used', async () => {
      // Arrange
      mockIsVarUsedInNodes.mockReturnValue(true)
      mockIsHovering = true
      const inputFields = createInputVarList(1)

      // Act
      render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={null}
          inputFields={inputFields}
          handleInputFieldsChange={vi.fn()}
          allVariableNames={[]}
        />,
      )

      // Find delete button in sortable container
      const sortableContainer = screen.getByTestId('sortable-container')
      const fieldItemButtons = sortableContainer.querySelectorAll('button.action-btn')
      if (fieldItemButtons.length >= 2)
        fireEvent.click(fieldItemButtons[1])

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('remove-var-confirm')).toBeInTheDocument()
      })
    })

    it('should remove directly when variable is not used', () => {
      // Arrange
      mockIsVarUsedInNodes.mockReturnValue(false)
      mockIsHovering = true
      const inputFields = createInputVarList(2)
      const handleInputFieldsChange = vi.fn()

      // Act
      render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={null}
          inputFields={inputFields}
          handleInputFieldsChange={handleInputFieldsChange}
          allVariableNames={[]}
        />,
      )

      // Find delete button in sortable container
      const sortableContainer = screen.getByTestId('sortable-container')
      const fieldItemButtons = sortableContainer.querySelectorAll('button.action-btn')
      if (fieldItemButtons.length >= 2)
        fireEvent.click(fieldItemButtons[1])

      // Assert
      expect(screen.queryByTestId('remove-var-confirm')).not.toBeInTheDocument()
      expect(handleInputFieldsChange).toHaveBeenCalled()
    })

    it('should not call handleInputFieldsChange immediately when variable is used (lines 70-72)', async () => {
      // Arrange - This tests that when variable is used, we show confirmation instead of removing directly
      mockIsVarUsedInNodes.mockReturnValue(true)
      mockIsHovering = true
      const inputFields = createInputVarList(1)
      const handleInputFieldsChange = vi.fn()

      // Act
      render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={null}
          inputFields={inputFields}
          handleInputFieldsChange={handleInputFieldsChange}
          allVariableNames={[]}
        />,
      )

      // Find delete button and click it
      const sortableContainer = screen.getByTestId('sortable-container')
      const fieldItemButtons = sortableContainer.querySelectorAll('button.action-btn')
      if (fieldItemButtons.length >= 2)
        fireEvent.click(fieldItemButtons[1])

      // Assert - handleInputFieldsChange should NOT be called yet (waiting for confirmation)
      await waitFor(() => {
        expect(screen.getByTestId('remove-var-confirm')).toBeInTheDocument()
      })
      expect(handleInputFieldsChange).not.toHaveBeenCalled()
    })

    it('should call isVarUsedInNodes with correct variable selector', async () => {
      // Arrange
      mockIsVarUsedInNodes.mockReturnValue(true)
      mockIsHovering = true
      const inputFields = [createInputVar({ variable: 'my_test_var' })]

      // Act
      render(
        <FieldList
          nodeId="test-node-123"
          LabelRightContent={null}
          inputFields={inputFields}
          handleInputFieldsChange={vi.fn()}
          allVariableNames={[]}
        />,
      )

      const sortableContainer = screen.getByTestId('sortable-container')
      const fieldItemButtons = sortableContainer.querySelectorAll('button.action-btn')
      if (fieldItemButtons.length >= 2)
        fireEvent.click(fieldItemButtons[1])

      // Assert
      expect(mockIsVarUsedInNodes).toHaveBeenCalledWith(['rag', 'test-node-123', 'my_test_var'])
    })

    it('should handle empty variable name gracefully', async () => {
      // Arrange - Tests line 70 with empty variable
      mockIsVarUsedInNodes.mockReturnValue(false)
      mockIsHovering = true
      const inputFields = [createInputVar({ variable: '' })]
      const handleInputFieldsChange = vi.fn()

      // Act
      render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={null}
          inputFields={inputFields}
          handleInputFieldsChange={handleInputFieldsChange}
          allVariableNames={[]}
        />,
      )

      const sortableContainer = screen.getByTestId('sortable-container')
      const fieldItemButtons = sortableContainer.querySelectorAll('button.action-btn')
      if (fieldItemButtons.length >= 2)
        fireEvent.click(fieldItemButtons[1])

      // Assert - should still work with empty variable
      expect(mockIsVarUsedInNodes).toHaveBeenCalledWith(['rag', 'node-1', ''])
    })

    it('should set removedVar and removedIndex when showing confirmation (lines 71-73)', async () => {
      // Arrange - Tests the setRemovedVar and setRemoveIndex calls in lines 71-73
      mockIsVarUsedInNodes.mockReturnValue(true)
      mockIsHovering = true
      const inputFields = createInputVarList(3)
      const handleInputFieldsChange = vi.fn()

      // Act
      render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={null}
          inputFields={inputFields}
          handleInputFieldsChange={handleInputFieldsChange}
          allVariableNames={[]}
        />,
      )

      // Click delete on the SECOND item (index 1)
      const sortableContainer = screen.getByTestId('sortable-container')
      const allFieldItemButtons = sortableContainer.querySelectorAll('button.action-btn')
      // Each field item has 2 buttons (edit, delete), so index 3 is delete of second item
      if (allFieldItemButtons.length >= 4)
        fireEvent.click(allFieldItemButtons[3])

      // Show confirmation
      await waitFor(() => {
        expect(screen.getByTestId('remove-var-confirm')).toBeInTheDocument()
      })

      // Click confirm
      fireEvent.click(screen.getByTestId('confirm-ok'))

      // Assert - should remove the correct item (var_1 at index 1)
      await waitFor(() => {
        expect(handleInputFieldsChange).toHaveBeenCalled()
      })
      const calledFields = handleInputFieldsChange.mock.calls[0][1]
      expect(calledFields.length).toBe(2) // 3 - 1 = 2 items remaining
      expect(calledFields.map((f: InputVar) => f.variable)).toEqual(['var_0', 'var_2'])
    })
  })

  // -------------------------------------------------------------------------
  // handleOpenInputFieldEditor Tests
  // -------------------------------------------------------------------------
  describe('handleOpenInputFieldEditor', () => {
    it('should call toggleInputFieldEditPanel with editor props', () => {
      // Arrange
      const inputFields = createInputVarList(1)

      // Act
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

      // Assert
      expect(mockToggleInputFieldEditPanel).toHaveBeenCalledWith(
        expect.objectContaining({
          onClose: expect.any(Function),
          onSubmit: expect.any(Function),
        }),
      )
    })

    it('should pass initialData when editing existing field', () => {
      // Arrange
      mockIsHovering = true
      const inputFields = [createInputVar({ variable: 'my_var', label: 'My Label' })]

      // Act
      render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={null}
          inputFields={inputFields}
          handleInputFieldsChange={vi.fn()}
          allVariableNames={[]}
        />,
      )
      // Find edit button in sortable container (first action button)
      const sortableContainer = screen.getByTestId('sortable-container')
      const fieldItemButtons = sortableContainer.querySelectorAll('button.action-btn')
      if (fieldItemButtons.length >= 1)
        fireEvent.click(fieldItemButtons[0])

      // Assert
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

  // -------------------------------------------------------------------------
  // onRemoveVarConfirm Tests
  // -------------------------------------------------------------------------
  describe('onRemoveVarConfirm', () => {
    it('should remove field and call removeUsedVarInNodes', async () => {
      // Arrange
      mockIsVarUsedInNodes.mockReturnValue(true)
      mockIsHovering = true
      const inputFields = createInputVarList(2)
      const handleInputFieldsChange = vi.fn()

      // Act
      render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={null}
          inputFields={inputFields}
          handleInputFieldsChange={handleInputFieldsChange}
          allVariableNames={[]}
        />,
      )

      // Find delete button in sortable container
      const sortableContainer = screen.getByTestId('sortable-container')
      const fieldItemButtons = sortableContainer.querySelectorAll('button.action-btn')
      if (fieldItemButtons.length >= 2)
        fireEvent.click(fieldItemButtons[1])

      await waitFor(() => {
        expect(screen.getByTestId('remove-var-confirm')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByTestId('confirm-ok'))

      // Assert
      await waitFor(() => {
        expect(handleInputFieldsChange).toHaveBeenCalled()
        expect(mockRemoveUsedVarInNodes).toHaveBeenCalled()
      })
    })
  })
})

// ============================================================================
// handleSubmitField Tests (via toggleInputFieldEditPanel mock)
// ============================================================================

describe('handleSubmitField', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsVarUsedInNodes.mockReturnValue(false)
    mockIsHovering = false
  })

  it('should add new field when editingFieldIndex is -1', () => {
    // Arrange
    const inputFields = createInputVarList(1)
    const handleInputFieldsChange = vi.fn()

    // Act
    render(
      <FieldList
        nodeId="node-1"
        LabelRightContent={null}
        inputFields={inputFields}
        handleInputFieldsChange={handleInputFieldsChange}
        allVariableNames={['var_0']}
      />,
    )

    // Click add button to open editor
    fireEvent.click(screen.getByTestId('field-list-add-btn'))

    // Get the onSubmit callback that was passed to toggleInputFieldEditPanel
    expect(mockToggleInputFieldEditPanel).toHaveBeenCalled()
    const editorProps = mockToggleInputFieldEditPanel.mock.calls[0][0]
    expect(editorProps).toHaveProperty('onSubmit')

    // Simulate form submission with new field data
    const newFieldData = createInputVar({ variable: 'new_var', label: 'New Label' })
    editorProps.onSubmit(newFieldData)

    // Assert
    expect(handleInputFieldsChange).toHaveBeenCalledWith(
      'node-1',
      expect.arrayContaining([
        expect.objectContaining({ variable: 'var_0' }),
        expect.objectContaining({ variable: 'new_var', label: 'New Label' }),
      ]),
    )
  })

  it('should update existing field when editingFieldIndex is valid', () => {
    // Arrange
    mockIsHovering = true
    const inputFields = createInputVarList(1)
    const handleInputFieldsChange = vi.fn()

    // Act
    render(
      <FieldList
        nodeId="node-1"
        LabelRightContent={null}
        inputFields={inputFields}
        handleInputFieldsChange={handleInputFieldsChange}
        allVariableNames={['var_0']}
      />,
    )

    // Click edit button on existing field
    const sortableContainer = screen.getByTestId('sortable-container')
    const fieldItemButtons = sortableContainer.querySelectorAll('button.action-btn')
    if (fieldItemButtons.length >= 1)
      fireEvent.click(fieldItemButtons[0])

    // Get the onSubmit callback
    const editorProps = mockToggleInputFieldEditPanel.mock.calls[0][0]

    // Simulate form submission with updated data
    const updatedFieldData = createInputVar({ variable: 'var_0', label: 'Updated Label' })
    editorProps.onSubmit(updatedFieldData)

    // Assert - field should be updated, not added
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
    // Arrange
    mockIsHovering = true
    const inputFields = createInputVarList(1)
    const handleInputFieldsChange = vi.fn()

    // Act
    render(
      <FieldList
        nodeId="node-1"
        LabelRightContent={null}
        inputFields={inputFields}
        handleInputFieldsChange={handleInputFieldsChange}
        allVariableNames={['var_0']}
      />,
    )

    // Click edit button
    const sortableContainer = screen.getByTestId('sortable-container')
    const fieldItemButtons = sortableContainer.querySelectorAll('button.action-btn')
    if (fieldItemButtons.length >= 1)
      fireEvent.click(fieldItemButtons[0])

    // Get the onSubmit callback
    const editorProps = mockToggleInputFieldEditPanel.mock.calls[0][0]

    // Simulate form submission with changed variable name (including moreInfo)
    const updatedFieldData = createInputVar({ variable: 'new_var_name', label: 'Label 0' })
    editorProps.onSubmit(updatedFieldData, {
      type: 'changeVarName',
      payload: { beforeKey: 'var_0', afterKey: 'new_var_name' },
    })

    // Assert
    expect(mockHandleInputVarRename).toHaveBeenCalledWith(
      'node-1',
      ['rag', 'node-1', 'var_0'],
      ['rag', 'node-1', 'new_var_name'],
    )
  })

  it('should not call handleInputVarRename when moreInfo type is not changeVarName', () => {
    // Arrange - This tests line 108 branch in hooks.ts
    mockIsHovering = true
    const inputFields = createInputVarList(1)
    const handleInputFieldsChange = vi.fn()

    // Act
    render(
      <FieldList
        nodeId="node-1"
        LabelRightContent={null}
        inputFields={inputFields}
        handleInputFieldsChange={handleInputFieldsChange}
        allVariableNames={['var_0']}
      />,
    )

    // Click edit button
    const sortableContainer = screen.getByTestId('sortable-container')
    const fieldItemButtons = sortableContainer.querySelectorAll('button.action-btn')
    if (fieldItemButtons.length >= 1)
      fireEvent.click(fieldItemButtons[0])

    // Get the onSubmit callback
    const editorProps = mockToggleInputFieldEditPanel.mock.calls[0][0]

    // Simulate form submission WITHOUT moreInfo (no variable name change)
    const updatedFieldData = createInputVar({ variable: 'var_0', label: 'Updated Label' })
    editorProps.onSubmit(updatedFieldData)

    // Assert - handleInputVarRename should NOT be called
    expect(mockHandleInputVarRename).not.toHaveBeenCalled()
    expect(handleInputFieldsChange).toHaveBeenCalled()
  })

  it('should not call handleInputVarRename when moreInfo has different type', () => {
    // Arrange - This tests line 108 branch in hooks.ts with different type
    mockIsHovering = true
    const inputFields = createInputVarList(1)
    const handleInputFieldsChange = vi.fn()

    // Act
    render(
      <FieldList
        nodeId="node-1"
        LabelRightContent={null}
        inputFields={inputFields}
        handleInputFieldsChange={handleInputFieldsChange}
        allVariableNames={['var_0']}
      />,
    )

    // Click edit button
    const sortableContainer = screen.getByTestId('sortable-container')
    const fieldItemButtons = sortableContainer.querySelectorAll('button.action-btn')
    if (fieldItemButtons.length >= 1)
      fireEvent.click(fieldItemButtons[0])

    // Get the onSubmit callback
    const editorProps = mockToggleInputFieldEditPanel.mock.calls[0][0]

    // Simulate form submission with moreInfo but different type
    const updatedFieldData = createInputVar({ variable: 'var_0', label: 'Updated Label' })
    editorProps.onSubmit(updatedFieldData, { type: 'otherType' as any })

    // Assert - handleInputVarRename should NOT be called
    expect(mockHandleInputVarRename).not.toHaveBeenCalled()
    expect(handleInputFieldsChange).toHaveBeenCalled()
  })

  it('should handle empty beforeKey and afterKey in moreInfo payload', () => {
    // Arrange - This tests line 108 with empty keys
    mockIsHovering = true
    const inputFields = createInputVarList(1)
    const handleInputFieldsChange = vi.fn()

    // Act
    render(
      <FieldList
        nodeId="node-1"
        LabelRightContent={null}
        inputFields={inputFields}
        handleInputFieldsChange={handleInputFieldsChange}
        allVariableNames={['var_0']}
      />,
    )

    // Click edit button
    const sortableContainer = screen.getByTestId('sortable-container')
    const fieldItemButtons = sortableContainer.querySelectorAll('button.action-btn')
    if (fieldItemButtons.length >= 1)
      fireEvent.click(fieldItemButtons[0])

    // Get the onSubmit callback
    const editorProps = mockToggleInputFieldEditPanel.mock.calls[0][0]

    // Simulate form submission with changeVarName but empty keys
    const updatedFieldData = createInputVar({ variable: 'new_var' })
    editorProps.onSubmit(updatedFieldData, {
      type: 'changeVarName',
      payload: { beforeKey: '', afterKey: '' },
    })

    // Assert - handleInputVarRename should be called with empty strings
    expect(mockHandleInputVarRename).toHaveBeenCalledWith(
      'node-1',
      ['rag', 'node-1', ''],
      ['rag', 'node-1', ''],
    )
  })

  it('should handle undefined payload in moreInfo', () => {
    // Arrange - This tests line 108 with undefined payload
    mockIsHovering = true
    const inputFields = createInputVarList(1)
    const handleInputFieldsChange = vi.fn()

    // Act
    render(
      <FieldList
        nodeId="node-1"
        LabelRightContent={null}
        inputFields={inputFields}
        handleInputFieldsChange={handleInputFieldsChange}
        allVariableNames={['var_0']}
      />,
    )

    // Click edit button
    const sortableContainer = screen.getByTestId('sortable-container')
    const fieldItemButtons = sortableContainer.querySelectorAll('button.action-btn')
    if (fieldItemButtons.length >= 1)
      fireEvent.click(fieldItemButtons[0])

    // Get the onSubmit callback
    const editorProps = mockToggleInputFieldEditPanel.mock.calls[0][0]

    // Simulate form submission with changeVarName but undefined payload
    const updatedFieldData = createInputVar({ variable: 'new_var' })
    editorProps.onSubmit(updatedFieldData, {
      type: 'changeVarName',
      payload: undefined,
    })

    // Assert - handleInputVarRename should be called with empty strings (fallback)
    expect(mockHandleInputVarRename).toHaveBeenCalledWith(
      'node-1',
      ['rag', 'node-1', ''],
      ['rag', 'node-1', ''],
    )
  })

  it('should close editor panel after successful submission', () => {
    // Arrange
    const inputFields = createInputVarList(1)
    const handleInputFieldsChange = vi.fn()

    // Act
    render(
      <FieldList
        nodeId="node-1"
        LabelRightContent={null}
        inputFields={inputFields}
        handleInputFieldsChange={handleInputFieldsChange}
        allVariableNames={['var_0']}
      />,
    )

    // Click add button
    fireEvent.click(screen.getByTestId('field-list-add-btn'))

    // Get the onSubmit callback
    const editorProps = mockToggleInputFieldEditPanel.mock.calls[0][0]

    // Simulate form submission
    const newFieldData = createInputVar({ variable: 'new_var' })
    editorProps.onSubmit(newFieldData)

    // Assert - toggleInputFieldEditPanel should be called with null to close
    expect(mockToggleInputFieldEditPanel).toHaveBeenCalledTimes(2)
    expect(mockToggleInputFieldEditPanel).toHaveBeenLastCalledWith(null)
  })

  it('should call onClose when editor is closed manually', () => {
    // Arrange
    const inputFields = createInputVarList(1)

    // Act
    render(
      <FieldList
        nodeId="node-1"
        LabelRightContent={null}
        inputFields={inputFields}
        handleInputFieldsChange={vi.fn()}
        allVariableNames={[]}
      />,
    )

    // Click add button
    fireEvent.click(screen.getByTestId('field-list-add-btn'))

    // Get the onClose callback
    const editorProps = mockToggleInputFieldEditPanel.mock.calls[0][0]
    expect(editorProps).toHaveProperty('onClose')

    // Simulate close
    editorProps.onClose()

    // Assert - toggleInputFieldEditPanel should be called with null
    expect(mockToggleInputFieldEditPanel).toHaveBeenLastCalledWith(null)
  })
})

// ============================================================================
// Duplicate Variable Name Handling Tests
// ============================================================================

describe('Duplicate Variable Name Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsVarUsedInNodes.mockReturnValue(false)
    mockIsHovering = false
  })

  it('should not add field if variable name is duplicate', async () => {
    // Arrange
    const Toast = await import('@/app/components/base/toast')
    const inputFields = createInputVarList(2)
    const handleInputFieldsChange = vi.fn()

    // Act
    render(
      <FieldList
        nodeId="node-1"
        LabelRightContent={null}
        inputFields={inputFields}
        handleInputFieldsChange={handleInputFieldsChange}
        allVariableNames={['var_0', 'var_1', 'existing_var']}
      />,
    )

    // Click add button
    fireEvent.click(screen.getByTestId('field-list-add-btn'))

    // Get the onSubmit callback
    const editorProps = mockToggleInputFieldEditPanel.mock.calls[0][0]

    // Try to submit with a duplicate variable name
    const duplicateFieldData = createInputVar({ variable: 'existing_var' })
    editorProps.onSubmit(duplicateFieldData)

    // Assert - handleInputFieldsChange should NOT be called
    expect(handleInputFieldsChange).not.toHaveBeenCalled()
    // Toast should be shown
    expect(Toast.default.notify).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error' }),
    )
  })

  it('should allow updating field to same variable name', () => {
    // Arrange
    mockIsHovering = true
    const inputFields = createInputVarList(2)
    const handleInputFieldsChange = vi.fn()

    // Act
    render(
      <FieldList
        nodeId="node-1"
        LabelRightContent={null}
        inputFields={inputFields}
        handleInputFieldsChange={handleInputFieldsChange}
        allVariableNames={['var_0', 'var_1']}
      />,
    )

    // Click edit button on first field
    const sortableContainer = screen.getByTestId('sortable-container')
    const fieldItemButtons = sortableContainer.querySelectorAll('button.action-btn')
    if (fieldItemButtons.length >= 1)
      fireEvent.click(fieldItemButtons[0])

    // Get the onSubmit callback
    const editorProps = mockToggleInputFieldEditPanel.mock.calls[0][0]

    // Submit with same variable name (just updating label)
    const updatedFieldData = createInputVar({ variable: 'var_0', label: 'New Label' })
    editorProps.onSubmit(updatedFieldData)

    // Assert - should allow update with same variable name
    expect(handleInputFieldsChange).toHaveBeenCalled()
  })
})

// ============================================================================
// SortableItem Type Tests
// ============================================================================

describe('SortableItem Type', () => {
  it('should have correct structure', () => {
    // Arrange
    const inputVar = createInputVar()
    const sortableItem = createSortableItem(inputVar)

    // Assert
    expect(sortableItem.id).toBe(inputVar.variable)
    expect(sortableItem.chosen).toBe(false)
    expect(sortableItem.selected).toBe(false)
    expect(sortableItem.type).toBe(inputVar.type)
    expect(sortableItem.variable).toBe(inputVar.variable)
    expect(sortableItem.label).toBe(inputVar.label)
  })

  it('should allow overriding sortable properties', () => {
    // Arrange
    const inputVar = createInputVar()
    const sortableItem = createSortableItem(inputVar, {
      chosen: true,
      selected: true,
    })

    // Assert
    expect(sortableItem.chosen).toBe(true)
    expect(sortableItem.selected).toBe(true)
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsHovering = false
    mockIsVarUsedInNodes.mockReturnValue(false)
  })

  describe('Complete Workflow', () => {
    it('should handle add -> edit -> remove workflow', async () => {
      // Arrange
      mockIsHovering = true
      const inputFields = createInputVarList(1)
      const handleInputFieldsChange = vi.fn()

      // Act - Render
      render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={<span>Fields</span>}
          inputFields={inputFields}
          handleInputFieldsChange={handleInputFieldsChange}
          allVariableNames={['var_0']}
        />,
      )

      // Step 1: Click add button (in header, outside sortable container)
      fireEvent.click(screen.getByTestId('field-list-add-btn'))
      expect(mockToggleInputFieldEditPanel).toHaveBeenCalled()

      // Step 2: Edit on existing field
      const sortableContainer = screen.getByTestId('sortable-container')
      const fieldItemButtons = sortableContainer.querySelectorAll('button.action-btn')
      if (fieldItemButtons.length >= 1) {
        fireEvent.click(fieldItemButtons[0])
        expect(mockToggleInputFieldEditPanel).toHaveBeenCalledTimes(2)
      }

      // Step 3: Remove field
      if (fieldItemButtons.length >= 2)
        fireEvent.click(fieldItemButtons[1])

      expect(handleInputFieldsChange).toHaveBeenCalled()
    })

    it('should handle sort operation correctly', () => {
      // Arrange
      const inputFields = createInputVarList(3)
      const handleInputFieldsChange = vi.fn()

      // Act
      render(
        <FieldList
          nodeId="node-1"
          LabelRightContent={null}
          inputFields={inputFields}
          handleInputFieldsChange={handleInputFieldsChange}
          allVariableNames={[]}
        />,
      )

      fireEvent.click(screen.getByTestId('trigger-sort'))

      // Assert
      expect(handleInputFieldsChange).toHaveBeenCalledWith(
        'node-1',
        expect.any(Array),
      )
      const newOrder = handleInputFieldsChange.mock.calls[0][1]
      // First two should be swapped
      expect(newOrder[0].variable).toBe('var_1')
      expect(newOrder[1].variable).toBe('var_0')
    })
  })

  describe('Props Propagation', () => {
    it('should propagate readonly prop through all components', () => {
      // Arrange
      const inputFields = createInputVarList(2)

      // Act
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

      // Assert
      const addButton = screen.getAllByRole('button').find(btn =>
        btn.querySelector('svg'),
      )
      expect(addButton).toBeDisabled()

      const sortableContainer = screen.getByTestId('sortable-container')
      expect(sortableContainer.dataset.disabled).toBe('true')
    })
  })
})
