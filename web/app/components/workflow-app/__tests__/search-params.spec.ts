import { ViewType } from '@/app/components/workflow/types'
import { parseAsViewType } from '../search-params'

describe('workflow-app search params', () => {
  it('should parse valid view values and serialize them unchanged', () => {
    expect(parseAsViewType.parse('graph')).toBe(ViewType.graph)
    expect(parseAsViewType.serialize(ViewType.graph)).toBe('graph')

    expect(parseAsViewType.parse('file')).toBe(ViewType.file)
    expect(parseAsViewType.serialize(ViewType.file)).toBe('file')
  })

  it('should reject unsupported view values', () => {
    expect(parseAsViewType.parse('skill')).toBeNull()
    expect(parseAsViewType.parse('invalid-view')).toBeNull()
  })
})
