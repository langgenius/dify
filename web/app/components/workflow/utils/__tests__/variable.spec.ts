import { BlockEnum } from '../../types'
import { isExceptionVariable, variableTransformer } from '../variable'

describe('variableTransformer', () => {
  describe('string → array (template to selector)', () => {
    it('should parse a simple template variable', () => {
      expect(variableTransformer('{{#node1.output#}}')).toEqual(['node1', 'output'])
    })

    it('should parse a deeply nested path', () => {
      expect(variableTransformer('{{#node1.data.items.0.name#}}')).toEqual(['node1', 'data', 'items', '0', 'name'])
    })

    it('should handle a single-segment path', () => {
      expect(variableTransformer('{{#value#}}')).toEqual(['value'])
    })
  })

  describe('array → string (selector to template)', () => {
    it('should join an array into a template variable', () => {
      expect(variableTransformer(['node1', 'output'])).toBe('{{#node1.output#}}')
    })

    it('should join a single-element array', () => {
      expect(variableTransformer(['value'])).toBe('{{#value#}}')
    })
  })
})

describe('isExceptionVariable', () => {
  const errorHandleTypes = [BlockEnum.LLM, BlockEnum.Tool, BlockEnum.HttpRequest, BlockEnum.Code, BlockEnum.Agent]

  it.each(errorHandleTypes)('should return true for error_message with %s node type', (nodeType) => {
    expect(isExceptionVariable('error_message', nodeType)).toBe(true)
  })

  it.each(errorHandleTypes)('should return true for error_type with %s node type', (nodeType) => {
    expect(isExceptionVariable('error_type', nodeType)).toBe(true)
  })

  it('should return false for error_message with non-error-handle node types', () => {
    expect(isExceptionVariable('error_message', BlockEnum.Start)).toBe(false)
    expect(isExceptionVariable('error_message', BlockEnum.End)).toBe(false)
    expect(isExceptionVariable('error_message', BlockEnum.IfElse)).toBe(false)
  })

  it('should return false for normal variables with error-handle node types', () => {
    expect(isExceptionVariable('output', BlockEnum.LLM)).toBe(false)
    expect(isExceptionVariable('text', BlockEnum.Tool)).toBe(false)
  })

  it('should return false when nodeType is undefined', () => {
    expect(isExceptionVariable('error_message')).toBe(false)
  })
})
