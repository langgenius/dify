import { describe, expect, it } from 'vitest'
import examples from '../examples'

describe('edit-custom-collection examples', () => {
  it('provides json, yaml, and blank templates in fixed order', () => {
    expect(examples.map(example => example.key)).toEqual([
      'json',
      'yaml',
      'blankTemplate',
    ])
  })

  it('contains representative OpenAPI content for each template', () => {
    expect(examples[0].content).toContain('"openapi": "3.1.0"')
    expect(examples[1].content).toContain('openapi: "3.0.0"')
    expect(examples[2].content).toContain('"title": "Untitled"')
  })
})
