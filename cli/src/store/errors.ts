import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'

export class ConcurrentAccessError extends BaseError {
  constructor(filePath: string) {
    const msg = `Another process is modifying the file ${filePath}. remove ${filePath}.lock to reset lock.`

    super({
      code: ErrorCode.ClientError,
      message: msg,
      hint: `remove ${filePath}.lock to reset lock.`,
    })
  }
}

type YamlMark = {
  line: number
  column: number
  snippet?: string
}

type YamlParseError = {
  reason?: string
  mark?: YamlMark
  message?: string
}

export class BadYamlFormatError extends BaseError {
  constructor(path: string, raw: string, cause: YamlParseError) {
    const reason = cause.reason ?? cause.message ?? 'invalid YAML'
    const mark = cause.mark
    const where = mark ? ` at line ${mark.line + 1}, column ${mark.column + 1}` : ''
    const snippet = mark?.snippet ?? excerpt(raw, mark)
    const header = `Failed to parse YAML file ${path}: ${reason}${where}.`
    const body = snippet ? `\n\n${snippet}` : ''

    super({
      code: ErrorCode.ClientError,
      message: `${header}${body}`,
      hint: `Fix the YAML syntax in ${path} or remove the file to reset it.`,
    })
  }
}

function excerpt(raw: string, mark: YamlMark | undefined): string {
  if (mark === undefined)
    return ''
  const lines = raw.split('\n')
  const target = mark.line
  if (target < 0 || target >= lines.length)
    return ''
  const start = Math.max(0, target - 2)
  const end = Math.min(lines.length, target + 3)
  const width = String(end).length
  const out: string[] = []
  for (let i = start; i < end; i++) {
    const marker = i === target ? '>' : ' '
    const num = String(i + 1).padStart(width, ' ')
    out.push(`${marker} ${num} | ${lines[i]}`)
    if (i === target)
      out.push(`${' '.repeat(width + 4)}${' '.repeat(mark.column)}^`)
  }
  return out.join('\n')
}
