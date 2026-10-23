import type { KnowledgeFsGoldenQuestionBulkImportRowPayload } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import { readString } from 'react-papaparse'

export const maxGoldenQuestionCsvBytes = 1024 * 1024
export const maxGoldenQuestionCsvRows = 500

const headerAliases = {
  evidence: new Set(['evidence', '证据']),
  question: new Set(['question', '问题']),
  tags: new Set(['tags', '标签']),
}

export type GoldenQuestionCsvError =
  | 'empty'
  | 'headers'
  | 'parse'
  | 'required'
  | 'size'
  | 'tooManyRows'

export function parseGoldenQuestionCsv(
  csv: string,
): KnowledgeFsGoldenQuestionBulkImportRowPayload[] {
  let data: string[][] | undefined
  let parseFailed = false
  readString<string[]>(csv, {
    complete: (result) => {
      data = result.data
      parseFailed = result.errors.length > 0
    },
    skipEmptyLines: 'greedy',
  })
  if (parseFailed || !data) throw new Error('parse')
  if (data.length < 2) throw new Error('empty')

  const headers = (data[0] ?? []).map((value) =>
    value
      .replace(/^\uFEFF/u, '')
      .trim()
      .toLowerCase(),
  )
  if (headers.length !== 3) throw new Error('headers')
  const indexes = {
    evidence: headers.findIndex((value) => headerAliases.evidence.has(value)),
    question: headers.findIndex((value) => headerAliases.question.has(value)),
    tags: headers.findIndex((value) => headerAliases.tags.has(value)),
  }
  if (Object.values(indexes).some((index) => index < 0)) throw new Error('headers')

  const sourceRows = data.slice(1)
  if (sourceRows.length > maxGoldenQuestionCsvRows) throw new Error('tooManyRows')
  const rows = sourceRows.map((row) => {
    if (row.length !== 3) throw new Error('headers')
    const question = (row[indexes.question] ?? '').trim()
    const evidence = (row[indexes.evidence] ?? '').trim()
    if (!question || !evidence) throw new Error('required')
    return {
      evidence,
      question,
      tags: (row[indexes.tags] ?? '')
        .split(/[,，;；|]/u)
        .map((tag) => tag.trim())
        .filter(Boolean),
    }
  })
  if (rows.length === 0) throw new Error('empty')
  return rows
}
