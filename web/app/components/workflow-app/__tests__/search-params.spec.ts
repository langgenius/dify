import { ViewType } from '@/app/components/workflow/types'
import { parseAsViewType } from '../search-params'

describe('workflow-app search params', () => {
  it('should parse valid view values and serialize them unchanged', () => {
    expect(parseAsViewType.parse('graph')).toBe(ViewType.graph)
    expect(parseAsViewType.serialize(ViewType.graph)).toBe('graph')

    expect(parseAsViewType.parse('files')).toBe(ViewType.files)
    expect(parseAsViewType.serialize(ViewType.files)).toBe('files')
  })

  it('should reject unsupported view values', () => {
    expect(parseAsViewType.parse('file')).toBeNull()
    expect(parseAsViewType.parse('skill')).toBeNull()
    expect(parseAsViewType.parse('invalid-view')).toBeNull()
  })
})
