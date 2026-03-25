import { ChatVarType } from '../../type'
import {
  buildObjectValueItems,
  formatChatVariableValue,
  formatObjectValueFromList,
  getEditorMinHeight,
  getEditorToggleLabelKey,
  getPlaceholderByType,
  getTypeChangeState,
  parseEditorContent,
  validateVariableName,
} from '../variable-modal.helpers'

describe('variable-modal helpers', () => {
  it('should build object items from a conversation variable value', () => {
    expect(buildObjectValueItems()).toHaveLength(1)

    expect(buildObjectValueItems({
      id: 'var-1',
      name: 'config',
      description: '',
      value_type: ChatVarType.Object,
      value: { apiKey: 'secret', timeout: 30 },
    })).toEqual([
      { key: 'apiKey', type: ChatVarType.String, value: 'secret' },
      { key: 'timeout', type: ChatVarType.Number, value: 30 },
    ])
  })

  it('should format object and array values for saving', () => {
    expect(formatObjectValueFromList([
      { key: 'apiKey', type: ChatVarType.String, value: 'secret' },
      { key: '', type: ChatVarType.Number, value: 1 },
    ])).toEqual({ apiKey: 'secret' })

    expect(formatChatVariableValue({
      editInJSON: false,
      objectValue: [{ key: 'enabled', type: ChatVarType.String, value: 'true' }],
      type: ChatVarType.Object,
      value: undefined,
    })).toEqual({ enabled: 'true' })

    expect(formatChatVariableValue({
      editInJSON: true,
      objectValue: [],
      type: ChatVarType.Object,
      value: { count: 1 },
    })).toEqual({ count: 1 })

    expect(formatChatVariableValue({
      editInJSON: false,
      objectValue: [],
      type: ChatVarType.ArrayString,
      value: ['a', '', 'b'],
    })).toEqual(['a', 'b'])

    expect(formatChatVariableValue({
      editInJSON: false,
      objectValue: [],
      type: ChatVarType.Number,
      value: undefined,
    })).toBe(0)

    expect(formatChatVariableValue({
      editInJSON: false,
      objectValue: [],
      type: ChatVarType.Boolean,
      value: undefined,
    })).toBe(true)

    expect(formatChatVariableValue({
      editInJSON: false,
      objectValue: [],
      type: ChatVarType.ArrayBoolean,
      value: undefined,
    })).toEqual([])
  })

  it('should derive placeholders, editor defaults, and editor toggle labels', () => {
    expect(getEditorMinHeight(ChatVarType.ArrayObject)).toBe('240px')
    expect(getEditorMinHeight(ChatVarType.Object)).toBe('120px')
    expect(getPlaceholderByType(ChatVarType.ArrayBoolean)).toBeTruthy()
    expect(getTypeChangeState(ChatVarType.Boolean).value).toBe(false)
    expect(getTypeChangeState(ChatVarType.ArrayBoolean).value).toEqual([false])
    expect(getTypeChangeState(ChatVarType.Object).objectValue).toHaveLength(1)
    expect(getTypeChangeState(ChatVarType.ArrayObject).editInJSON).toBe(true)
    expect(getEditorToggleLabelKey(ChatVarType.Object, true)).toBe('chatVariable.modal.editInForm')
    expect(getEditorToggleLabelKey(ChatVarType.ArrayString, false)).toBe('chatVariable.modal.editInJSON')
  })

  it('should parse boolean arrays from JSON editor content', () => {
    expect(parseEditorContent({
      content: '["True","false",true,false,"invalid"]',
      type: ChatVarType.ArrayBoolean,
    })).toEqual([true, false, true, false])

    expect(parseEditorContent({
      content: '{"enabled":true}',
      type: ChatVarType.Object,
    })).toEqual({ enabled: true })
  })

  it('should validate variable names and notify when invalid', () => {
    const notify = vi.fn()
    const t = (key: string) => key

    expect(validateVariableName({
      name: 'valid_name',
      notify,
      t,
    })).toBe(true)

    expect(validateVariableName({
      name: '1invalid',
      notify,
      t,
    })).toBe(false)

    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      type: 'error',
    }))
  })
})
