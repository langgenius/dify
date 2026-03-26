import { ViewType } from '@/app/components/workflow/types'
import { parseAsViewType } from '../search-params'

describe('workflow-app search params', () => {
  it('should parse the new file view value and keep serializing it as file', () => {
    expect(parseAsViewType.parse('file')).toBe(ViewType.file)
    expect(parseAsViewType.serialize(ViewType.file)).toBe('file')
  })

  it('should keep supporting legacy skill view links by mapping them to file', () => {
    expect(parseAsViewType.parse('skill')).toBe(ViewType.file)
  })

  it('should reject unsupported view values', () => {
    expect(parseAsViewType.parse('invalid-view')).toBeNull()
  })
})
