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

export const replaceTrailingSlashWithToken = (value: string, token: string) => {
  if (!value.endsWith('/'))
    return appendToken(value, token)

  const valueWithoutSlash = value.slice(0, -1)
  if (!valueWithoutSlash)
    return token

  return `${valueWithoutSlash}${valueWithoutSlash.endsWith(' ') || valueWithoutSlash.endsWith('\n') ? '' : ' '}${token}`
}
