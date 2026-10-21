import { BlockEnum } from '../../types'
import { isExceptionVariable, variableTransformer } from '../variable'

describe('variableTransformer', () => {
  it.each([
    ['{{#node1.output#}}', ['node1', 'output']],
    ['{{#node1.data.items.0.name#}}', ['node1', 'data', 'items', '0', 'name']],
  ] as const)('converts %s between template text and its selector', (template, selector) => {
    expect(variableTransformer(template)).toEqual(selector)
    expect(variableTransformer([...selector])).toBe(template)
  })
})

describe('isExceptionVariable', () => {
  const errorHandleTypes = [
    BlockEnum.LLM,
    BlockEnum.Tool,
    BlockEnum.HttpRequest,
    BlockEnum.Code,
    BlockEnum.Agent,
  ]

  it.each(errorHandleTypes)('recognizes both exception outputs for %s', (nodeType) => {
    expect(isExceptionVariable('error_message', nodeType)).toBe(true)
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
