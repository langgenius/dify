import type { ChangeEvent } from 'react'
import { act, renderHook } from '@testing-library/react'
import { ChatVarType } from '../../type'
import { useVariableModalState } from '../use-variable-modal-state'

vi.mock('uuid', () => ({
  v4: () => 'generated-id',
}))

const createOptions = (overrides: Partial<Parameters<typeof useVariableModalState>[0]> = {}) => ({
  chatVar: undefined,
  conversationVariables: [],
  notify: vi.fn(),
  onClose: vi.fn(),
  onSave: vi.fn(),
  t: (key: string) => key,
  ...overrides,
})

describe('useVariableModalState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should build initial state from an existing array object variable', () => {
    const { result } = renderHook(() => useVariableModalState(createOptions({
      chatVar: {
        id: 'var-1',
        name: 'payload',
        description: 'desc',
        value_type: ChatVarType.ArrayObject,
        value: [{ enabled: true }],
      },
    })))

    expect(result.current.name).toBe('payload')
    expect(result.current.description).toBe('desc')
    expect(result.current.type).toBe(ChatVarType.ArrayObject)
    expect(result.current.editInJSON).toBe(true)
    expect(result.current.editorContent).toBe(JSON.stringify([{ enabled: true }]))
  })

  it('should update state when changing types and editing scalar values', () => {
    const { result } = renderHook(() => useVariableModalState(createOptions()))

    act(() => {
      result.current.handleTypeChange(ChatVarType.Object)
    })
    expect(result.current.type).toBe(ChatVarType.Object)
    expect(result.current.objectValue).toHaveLength(1)

    act(() => {
      result.current.handleTypeChange(ChatVarType.Number)
      result.current.handleStringOrNumberChange([12])
    })
    expect(result.current.value).toBe(12)

    act(() => {
      result.current.setDescription('note')
      result.current.setValue(true)
    })
    expect(result.current.description).toBe('note')
    expect(result.current.value).toBe(true)
  })

  it('should toggle object values between form and json modes', () => {
    const { result } = renderHook(() => useVariableModalState(createOptions({
      chatVar: {
        id: 'var-2',
        name: 'config',
        description: '',
        value_type: ChatVarType.Object,
        value: { timeout: 30 },
      },
    })))

    act(() => {
      result.current.handleEditorChange(true)
    })
    expect(result.current.editInJSON).toBe(true)
    expect(result.current.editorContent).toBe(JSON.stringify({ timeout: 30 }))

    act(() => {
      result.current.handleEditorValueChange('{"timeout":45}')
      result.current.handleEditorChange(false)
    })
    expect(result.current.editInJSON).toBe(false)
    expect(result.current.objectValue).toEqual([
      { key: 'timeout', type: ChatVarType.Number, value: 45 },
    ])
  })

  it('should keep valid object rows when switching to json mode from form mode', () => {
    const { result } = renderHook(() => useVariableModalState(createOptions()))

    act(() => {
      result.current.handleTypeChange(ChatVarType.Object)
      result.current.setObjectValue([
        { key: '', type: ChatVarType.String, value: undefined },
        { key: 'timeout', type: ChatVarType.Number, value: 30 },
      ])
      result.current.handleEditorChange(true)
    })

    expect(result.current.editInJSON).toBe(true)
    expect(result.current.value).toEqual({ timeout: 30 })
    expect(result.current.editorContent).toBe(JSON.stringify({ timeout: 30 }))
  })
  it('should reset object form values when leaving empty json mode', () => {
    const { result } = renderHook(() => useVariableModalState(createOptions({
      chatVar: {
        id: 'var-3',
        name: 'config',
        description: '',
        value_type: ChatVarType.Object,
        value: {},
      },
    })))

    act(() => {
      result.current.handleEditorChange(true)
      result.current.handleEditorValueChange('')
      result.current.handleEditorChange(false)
    })

    expect(result.current.objectValue).toHaveLength(1)
    expect(result.current.value).toBeUndefined()
  })

  it('should handle array editor toggles and invalid json safely', () => {
    const { result } = renderHook(() => useVariableModalState(createOptions()))

    act(() => {
      result.current.handleTypeChange(ChatVarType.ArrayString)
      result.current.setValue(['a', '', 'b'])
      result.current.handleEditorChange(true)
    })
    expect(result.current.editInJSON).toBe(true)
    expect(result.current.value).toEqual(['a', 'b'])

    act(() => {
      result.current.handleEditorValueChange('[invalid')
    })
    expect(result.current.editorContent).toBe('[invalid')
    expect(result.current.value).toEqual(['a', 'b'])

    act(() => {
      result.current.handleEditorChange(false)
    })
    expect(result.current.value).toEqual(['a', 'b'])

    act(() => {
      result.current.handleTypeChange(ChatVarType.ArrayBoolean)
      result.current.setValue([true, false])
      result.current.handleEditorChange(true)
    })
    expect(result.current.editorContent).toBe(JSON.stringify(['True', 'False']))
  })

  it('should preserve zero values when switching number arrays into json mode', () => {
    const { result } = renderHook(() => useVariableModalState(createOptions()))

    act(() => {
      result.current.handleTypeChange(ChatVarType.ArrayNumber)
      result.current.setValue([0, 2, undefined])
      result.current.handleEditorChange(true)
    })

    expect(result.current.editInJSON).toBe(true)
    expect(result.current.value).toEqual([0, 2])
    expect(result.current.editorContent).toBe(JSON.stringify([0, 2]))
  })
  it('should notify and stop saving when object keys are invalid', () => {
    const notify = vi.fn()
    const onSave = vi.fn()
    const onClose = vi.fn()
    const { result } = renderHook(() => useVariableModalState(createOptions({
      notify,
      onClose,
      onSave,
    })))

    act(() => {
      result.current.handleVarNameChange({ target: { value: 'config' } } as ChangeEvent<HTMLInputElement>)
      result.current.handleTypeChange(ChatVarType.Object)
      result.current.setObjectValue([{ key: '', type: ChatVarType.String, value: 'secret' }])
    })

    act(() => {
      result.current.handleSave()
    })

    expect(notify).toHaveBeenCalledWith({ type: 'error', message: 'chatVariable.modal.objectKeyRequired' })
    expect(onSave).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('should save a new variable and close when state is valid', () => {
    const onSave = vi.fn()
    const onClose = vi.fn()
    const { result } = renderHook(() => useVariableModalState(createOptions({
      onClose,
      onSave,
    })))

    act(() => {
      result.current.handleVarNameChange({ target: { value: 'greeting' } } as ChangeEvent<HTMLInputElement>)
      result.current.handleStringOrNumberChange(['hello'])
    })

    act(() => {
      result.current.handleSave()
    })

    expect(onSave).toHaveBeenCalledWith({
      description: '',
      id: 'generated-id',
      name: 'greeting',
      value: 'hello',
      value_type: ChatVarType.String,
    })
    expect(onClose).toHaveBeenCalled()
  })
})
