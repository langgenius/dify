/**
 * @public
 */
// TODO: Remove this marker after prompt option menus are wired.
export type AgentPromptOptionLabelKey
  = | 'agentDetail.configure.prompt.insert.tenders'
    | 'agentDetail.configure.prompt.insert.question'
    | 'agentDetail.configure.prompt.insert.reportFile'
    | 'agentDetail.configure.prompt.mention.davidHayes'
    | 'agentDetail.configure.prompt.mention.priyaRamanathan'

/**
 * @public
 */
// TODO: Remove this marker after prompt option menus are wired.
export type InsertOption = {
  key: string
  labelKey: AgentPromptOptionLabelKey
  token: string
  icon: string
}

/**
 * @public
 */
// TODO: Remove this marker after prompt option menus are wired.
export const insertOptions: InsertOption[] = [
  {
    key: 'tenders',
    labelKey: 'agentDetail.configure.prompt.insert.tenders',
    token: '{{tenders}}',
    icon: 'i-ri-home-4-line',
  },
  {
    key: 'question',
    labelKey: 'agentDetail.configure.prompt.insert.question',
    token: '{{question}}',
    icon: 'i-ri-question-answer-line',
  },
  {
    key: 'reportFile',
    labelKey: 'agentDetail.configure.prompt.insert.reportFile',
    token: '{{qna_report_pdf}}',
    icon: 'i-ri-file-pdf-2-line',
  },
]

/**
 * @public
 */
// TODO: Remove this marker after prompt option menus are wired.
export const mentionOptions: InsertOption[] = [
  {
    key: 'davidHayes',
    labelKey: 'agentDetail.configure.prompt.mention.davidHayes',
    token: '{{DavidHayes}}',
    icon: 'i-ri-user-line',
  },
  {
    key: 'priyaRamanathan',
    labelKey: 'agentDetail.configure.prompt.mention.priyaRamanathan',
    token: '{{PriyaRamanathan}}',
    icon: 'i-ri-user-line',
  },
]

const appendToken = (value: string, token: string) => {
  if (!value)
    return token

  return `${value}${value.endsWith(' ') || value.endsWith('\n') ? '' : ' '}${token}`
}

export type TextRange = {
  start: number
  end: number
}

export type TokenInsertionResult = {
  value: string
  cursorOffset: number
}

const hasTrailingSpace = (value: string) => value.endsWith(' ') || value.endsWith('\n')

const hasLeadingSpace = (value: string) => value.startsWith(' ') || value.startsWith('\n')

export const replaceTrailingSlashWithToken = (value: string, token: string) => {
  if (!value.endsWith('/'))
    return appendToken(value, token)

  const valueWithoutSlash = value.slice(0, -1)
  if (!valueWithoutSlash)
    return token

  return `${valueWithoutSlash}${hasTrailingSpace(valueWithoutSlash) ? '' : ' '}${token}`
}

export const insertTokenAtTextRange = (value: string, range: TextRange, token: string): TokenInsertionResult => {
  const start = Math.max(0, Math.min(range.start, value.length))
  const end = Math.max(start, Math.min(range.end, value.length))
  const prefix = value.slice(0, start)
  const suffix = value.slice(end)
  const beforeToken = prefix && !hasTrailingSpace(prefix) ? ' ' : ''
  const afterToken = suffix && !hasLeadingSpace(suffix) ? ' ' : ''

  return {
    value: `${prefix}${beforeToken}${token}${afterToken}${suffix}`,
    cursorOffset: prefix.length + beforeToken.length + token.length + afterToken.length,
  }
}
