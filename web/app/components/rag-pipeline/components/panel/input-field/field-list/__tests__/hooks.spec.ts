import type { InputVar } from '@/models/pipeline'
import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFieldList } from '../hooks'

const mockToggleInputFieldEditPanel = vi.fn()
vi.mock('@/app/components/rag-pipeline/hooks', () => ({
  useInputFieldPanel: () => ({
    toggleInputFieldEditPanel: mockToggleInputFieldEditPanel,
  }),
}))

const mockHandleInputVarRename = vi.fn()
const mockIsVarUsedInNodes = vi.fn()
const mockRemoveUsedVarInNodes = vi.fn()
vi.mock('../../../../../hooks/use-pipeline', () => ({
  usePipeline: () => ({
    handleInputVarRename: mockHandleInputVarRename,
    isVarUsedInNodes: mockIsVarUsedInNodes,
    removeUsedVarInNodes: mockRemoveUsedVarInNodes,
  }),
}))

const mockToastNotify = vi.fn()
vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: (...args: unknown[]) => mockToastNotify(...args),
  },
}))

vi.mock('@/app/components/workflow/types', () => ({
  ChangeType: {
    changeVarName: 'changeVarName',
    remove: 'remove',
  },
}))

function createInputVar(overrides?: Partial<InputVar>): InputVar {
  return {
    type: 'text-input',
    variable: 'test_var',
    label: 'Test Var',
    required: false,
    ...overrides,
  } as InputVar
}

function createDefaultProps(overrides?: Partial<Parameters<typeof useFieldList>[0]>) {
  return {
    initialInputFields: [] as InputVar[],
    onInputFieldsChange: vi.fn(),
    nodeId: 'node-1',
    allVariableNames: [] as string[],
    ...overrides,
  }
}

describe('useFieldList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsVarUsedInNodes.mockReturnValue(false)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('initialization', () => {
    it('should return inputFields from initialInputFields', () => {
      const fields = [createInputVar({ variable: 'var1' })]
      const { result } = renderHook(() => useFieldList(createDefaultProps({ initialInputFields: fields })))

      expect(result.current.inputFields).toEqual(fields)
    })

    it('should return empty inputFields when initialized with empty array', () => {
      const { result } = renderHook(() => useFieldList(createDefaultProps()))

      expect(result.current.inputFields).toEqual([])
    })

    it('should return all expected functions', () => {
      const { result } = renderHook(() => useFieldList(createDefaultProps()))

      expect(typeof result.current.handleListSortChange).toBe('function')
      expect(typeof result.current.handleRemoveField).toBe('function')
      expect(typeof result.current.handleOpenInputFieldEditor).toBe('function')
      expect(typeof result.current.hideRemoveVarConfirm).toBe('function')
      expect(typeof result.current.onRemoveVarConfirm).toBe('function')
    })

    it('should have isShowRemoveVarConfirm as false initially', () => {
      const { result } = renderHook(() => useFieldList(createDefaultProps()))

      expect(result.current.isShowRemoveVarConfirm).toBe(false)
    })
  })

  describe('handleListSortChange', () => {
    it('should reorder input fields and notify parent', () => {
      const var1 = createInputVar({ variable: 'var1', label: 'V1' })
      const var2 = createInputVar({ variable: 'var2', label: 'V2' })
      const onInputFieldsChange = vi.fn()
      const { result } = renderHook(() =>
        useFieldList(createDefaultProps({
          initialInputFields: [var1, var2],
          onInputFieldsChange,
        })),
      )

      act(() => {
        result.current.handleListSortChange([
          { ...var2, id: '1', chosen: false, selected: false },
          { ...var1, id: '0', chosen: false, selected: false },
        ])
      })

      expect(onInputFieldsChange).toHaveBeenCalledWith([var2, var1])
    })

    it('should strip sortable metadata (id, chosen, selected) from items', () => {
      const var1 = createInputVar({ variable: 'var1' })
      const onInputFieldsChange = vi.fn()
      const { result } = renderHook(() =>
        useFieldList(createDefaultProps({
          initialInputFields: [var1],
          onInputFieldsChange,
        })),
      )

      act(() => {
        result.current.handleListSortChange([
          { ...var1, id: '0', chosen: true, selected: true },
        ])
      })

      const updatedFields = onInputFieldsChange.mock.calls[0][0]
      expect(updatedFields[0]).not.toHaveProperty('id')
      expect(updatedFields[0]).not.toHaveProperty('chosen')
      expect(updatedFields[0]).not.toHaveProperty('selected')
    })
  })

  describe('handleRemoveField', () => {
    it('should remove field when variable is not used in nodes', () => {
      const var1 = createInputVar({ variable: 'var1' })
      const var2 = createInputVar({ variable: 'var2' })
      const onInputFieldsChange = vi.fn()
      mockIsVarUsedInNodes.mockReturnValue(false)

      const { result } = renderHook(() =>
        useFieldList(createDefaultProps({
          initialInputFields: [var1, var2],
          onInputFieldsChange,
        })),
      )

      act(() => {
        result.current.handleRemoveField(0)
      })

      expect(onInputFieldsChange).toHaveBeenCalledWith([var2])
    })

    it('should show confirmation when variable is used in other nodes', () => {
      const var1 = createInputVar({ variable: 'used_var' })
      const onInputFieldsChange = vi.fn()
      mockIsVarUsedInNodes.mockReturnValue(true)

      const { result } = renderHook(() =>
        useFieldList(createDefaultProps({
          initialInputFields: [var1],
          onInputFieldsChange,
        })),
      )

      act(() => {
        result.current.handleRemoveField(0)
      })

      expect(result.current.isShowRemoveVarConfirm).toBe(true)
      expect(onInputFieldsChange).not.toHaveBeenCalled()
    })
  })

  describe('onRemoveVarConfirm', () => {
    it('should remove field and clean up variable references after confirmation', () => {
      const var1 = createInputVar({ variable: 'used_var' })
      const onInputFieldsChange = vi.fn()
      mockIsVarUsedInNodes.mockReturnValue(true)

      const { result } = renderHook(() =>
        useFieldList(createDefaultProps({
          initialInputFields: [var1],
          onInputFieldsChange,
          nodeId: 'node-1',
        })),
      )

      act(() => {
        result.current.handleRemoveField(0)
      })

      expect(result.current.isShowRemoveVarConfirm).toBe(true)

      act(() => {
        result.current.onRemoveVarConfirm()
      })

      expect(onInputFieldsChange).toHaveBeenCalledWith([])
      expect(mockRemoveUsedVarInNodes).toHaveBeenCalledWith(['rag', 'node-1', 'used_var'])
      expect(result.current.isShowRemoveVarConfirm).toBe(false)
    })
  })

  describe('handleOpenInputFieldEditor', () => {
    it('should open editor with existing field data when id matches', () => {
      const var1 = createInputVar({ variable: 'var1', label: 'Label 1' })
      const { result } = renderHook(() =>
        useFieldList(createDefaultProps({ initialInputFields: [var1] })),
      )

      act(() => {
        result.current.handleOpenInputFieldEditor('var1')
      })

      expect(mockToggleInputFieldEditPanel).toHaveBeenCalledWith(
        expect.objectContaining({
          initialData: var1,
        }),
      )
    })

    it('should open editor for new field when id does not match', () => {
      const { result } = renderHook(() =>
        useFieldList(createDefaultProps()),
      )

      act(() => {
        result.current.handleOpenInputFieldEditor('non-existent')
      })

      expect(mockToggleInputFieldEditPanel).toHaveBeenCalledWith(
        expect.objectContaining({
          initialData: undefined,
        }),
      )
    })

    it('should open editor for new field when no id provided', () => {
      const { result } = renderHook(() =>
        useFieldList(createDefaultProps()),
      )

      act(() => {
        result.current.handleOpenInputFieldEditor()
      })

      expect(mockToggleInputFieldEditPanel).toHaveBeenCalledWith(
        expect.objectContaining({
          initialData: undefined,
        }),
      )
    })
  })

  describe('field submission (via editor)', () => {
    it('should add new field when editingFieldIndex is -1', () => {
      const onInputFieldsChange = vi.fn()
      const { result } = renderHook(() =>
        useFieldList(createDefaultProps({ onInputFieldsChange })),
      )

      act(() => {
        result.current.handleOpenInputFieldEditor()
      })

      const editorProps = mockToggleInputFieldEditPanel.mock.calls[0][0]
      const newField = createInputVar({ variable: 'new_var', label: 'New' })

      act(() => {
        editorProps.onSubmit(newField)
      })

      expect(onInputFieldsChange).toHaveBeenCalledWith([newField])
    })

    it('should show error toast for duplicate variable names', () => {
      const var1 = createInputVar({ variable: 'existing_var' })
      const onInputFieldsChange = vi.fn()
      const { result } = renderHook(() =>
        useFieldList(createDefaultProps({
          initialInputFields: [var1],
          onInputFieldsChange,
          allVariableNames: ['existing_var'],
        })),
      )

      act(() => {
        result.current.handleOpenInputFieldEditor()
      })

      const editorProps = mockToggleInputFieldEditPanel.mock.calls[0][0]
      const duplicateField = createInputVar({ variable: 'existing_var' })

      act(() => {
        editorProps.onSubmit(duplicateField)
      })

      expect(mockToastNotify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error' }),
      )
      expect(onInputFieldsChange).not.toHaveBeenCalled()
    })

    it('should trigger variable rename when ChangeType is changeVarName', () => {
      const var1 = createInputVar({ variable: 'old_name' })
      const onInputFieldsChange = vi.fn()
      const { result } = renderHook(() =>
        useFieldList(createDefaultProps({
          initialInputFields: [var1],
          onInputFieldsChange,
          nodeId: 'node-1',
          allVariableNames: ['old_name'],
        })),
      )

      act(() => {
        result.current.handleOpenInputFieldEditor('old_name')
      })

      const editorProps = mockToggleInputFieldEditPanel.mock.calls[0][0]
      const updatedField = createInputVar({ variable: 'new_name' })

      act(() => {
        editorProps.onSubmit(updatedField, {
          type: 'changeVarName',
          payload: { beforeKey: 'old_name', afterKey: 'new_name' },
        })
      })

      expect(mockHandleInputVarRename).toHaveBeenCalledWith(
        'node-1',
        ['rag', 'node-1', 'old_name'],
        ['rag', 'node-1', 'new_name'],
      )
    })
  })

  describe('hideRemoveVarConfirm', () => {
    it('should hide the confirmation dialog', () => {
      const var1 = createInputVar({ variable: 'used_var' })
      mockIsVarUsedInNodes.mockReturnValue(true)

      const { result } = renderHook(() =>
        useFieldList(createDefaultProps({ initialInputFields: [var1] })),
      )

      act(() => {
        result.current.handleRemoveField(0)
      })
      expect(result.current.isShowRemoveVarConfirm).toBe(true)

      act(() => {
        result.current.hideRemoveVarConfirm()
      })
      expect(result.current.isShowRemoveVarConfirm).toBe(false)
    })
  })
})
