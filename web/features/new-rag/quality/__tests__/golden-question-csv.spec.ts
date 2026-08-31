import { describe, expect, it } from 'vitest'
import { maxGoldenQuestionCsvRows, parseGoldenQuestionCsv } from '../golden-question-csv'

describe('parseGoldenQuestionCsv', () => {
  it('accepts localized headers and quoted tag lists', () => {
    expect(
      parseGoldenQuestionCsv('问题,证据,标签\n退款期多久?,退款期为 30 天,"billing,政策"'),
    ).toEqual([
      {
        evidence: '退款期为 30 天',
        question: '退款期多久?',
        tags: ['billing', '政策'],
      },
    ])
  })

  it('requires exactly the question, evidence, and tags columns', () => {
    expect(() => parseGoldenQuestionCsv('question,evidence,tags,notes\nQ,E,T,N')).toThrow('headers')
    expect(() => parseGoldenQuestionCsv('question,evidence,tags\nQ,,T')).toThrow('required')
  })

  it('rejects imports above the batch limit before submission', () => {
    const rows = Array.from(
      { length: maxGoldenQuestionCsvRows + 1 },
      (_, index) => `Question ${index},Evidence ${index},tag`,
    )
    expect(() => parseGoldenQuestionCsv(`question,evidence,tags\n${rows.join('\n')}`)).toThrow(
      'tooManyRows',
    )
  })
})
