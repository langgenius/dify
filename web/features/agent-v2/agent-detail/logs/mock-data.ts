import type { I18nKeysWithPrefix } from '@/types/i18n'

export type PeriodKey = 'last7days' | 'last30days' | 'allTime'
export type SourceKey = 'all' | 'webapp' | 'workflow'

export type FilterOption<T extends string> = {
  value: T
  labelKey: I18nKeysWithPrefix<'agentV2', 'agentDetail.logs.'>
}

type AgentLogRow = {
  id: string
  title: string
  endUser: string
  messageCount: number
  userRate: string
  operationRate: string
  updatedTime: string
  createdTime: string
  source: Exclude<SourceKey, 'all'>
  unread?: boolean
}

export const periodOptions: Array<FilterOption<PeriodKey>> = [
  { value: 'last7days', labelKey: 'agentDetail.logs.filters.period.last7days' },
  { value: 'last30days', labelKey: 'agentDetail.logs.filters.period.last30days' },
  { value: 'allTime', labelKey: 'agentDetail.logs.filters.period.allTime' },
]

export const sourceOptions: Array<FilterOption<SourceKey>> = [
  { value: 'all', labelKey: 'agentDetail.logs.filters.source.all' },
  { value: 'webapp', labelKey: 'agentDetail.logs.filters.source.webapp' },
  { value: 'workflow', labelKey: 'agentDetail.logs.filters.source.workflow' },
]

const LOG_ROW_COUNT = 5400
const LOG_INTERVAL_MINUTES = 2
const baseLogTime = new Date(2023, 2, 21, 10, 25)
const periodDays: Partial<Record<PeriodKey, number>> = {
  last7days: 7,
  last30days: 30,
}

const logTemplates: AgentLogRow[] = [
  {
    id: 'log_001',
    title: 'Asking about Dify agent orchestration best practices',
    endUser: '94924171-e6b0-4076-8f54-71d4370af8ef',
    messageCount: 2,
    userRate: 'N/A',
    operationRate: 'N/A',
    updatedTime: '2023-03-21 10:25',
    createdTime: '2023-03-21 10:25',
    source: 'webapp',
    unread: true,
  },
  {
    id: 'log_002',
    title: 'Alice, our user, talks about prompt orchestration techniques',
    endUser: 'N/A',
    messageCount: 3,
    userRate: 'N/A',
    operationRate: 'N/A',
    updatedTime: '2023-03-21 10:25',
    createdTime: '2023-03-21 10:25',
    source: 'workflow',
    unread: true,
  },
  {
    id: 'log_003',
    title: 'How to self-host a Dify chatbot for an internal team',
    endUser: '94924171-e6b0-4076-8f54-71d4370af8ef',
    messageCount: 5,
    userRate: 'N/A',
    operationRate: 'N/A',
    updatedTime: '2023-03-21 10:25',
    createdTime: '2023-03-21 10:25',
    source: 'webapp',
    unread: true,
  },
  {
    id: 'log_004',
    title: 'Requesting information about dataset retrieval settings',
    endUser: '94924171-e6b0-4076-8f54-71d4370af8ef',
    messageCount: 1,
    userRate: 'N/A',
    operationRate: 'N/A',
    updatedTime: '2023-03-21 10:25',
    createdTime: '2023-03-21 10:25',
    source: 'workflow',
    unread: true,
  },
  {
    id: 'log_005',
    title: 'Exploring options for connecting external knowledge bases',
    endUser: 'N/A',
    messageCount: 3,
    userRate: 'N/A',
    operationRate: 'N/A',
    updatedTime: '2023-03-21 10:25',
    createdTime: '2023-03-21 10:25',
    source: 'webapp',
    unread: true,
  },
  {
    id: 'log_006',
    title: 'What types of plugin tools can be used in workflows?',
    endUser: '94924171-e6b0-4076-8f54-71d4370af8ef',
    messageCount: 2,
    userRate: 'N/A',
    operationRate: 'N/A',
    updatedTime: '2023-03-21 10:25',
    createdTime: '2023-03-21 10:25',
    source: 'workflow',
    unread: true,
  },
  {
    id: 'log_007',
    title: 'Querying about Dify cloud deployment requirements',
    endUser: '94924171-e6b0-4076-8f54-71d4370af8ef',
    messageCount: 2,
    userRate: 'N/A',
    operationRate: 'N/A',
    updatedTime: '2023-03-21 10:25',
    createdTime: '2023-03-21 10:25',
    source: 'webapp',
    unread: true,
  },
  {
    id: 'log_008',
    title: 'Seeking assistance with YAML file setup',
    endUser: '94924171-e6b0-4076-8f54-71d4370af8ef',
    messageCount: 2,
    userRate: 'N/A',
    operationRate: 'N/A',
    updatedTime: '2023-03-21 10:25',
    createdTime: '2023-03-21 10:25',
    source: 'workflow',
    unread: true,
  },
  {
    id: 'log_009',
    title: 'Inquiring about compatibility with external APIs',
    endUser: '94924171-e6b0-4076-8f54-71d4370af8ef',
    messageCount: 5,
    userRate: 'N/A',
    operationRate: 'N/A',
    updatedTime: '2023-03-21 10:25',
    createdTime: '2023-03-21 10:25',
    source: 'webapp',
    unread: true,
  },
  {
    id: 'log_010',
    title: 'Can Dify integrate with my existing CRM?',
    endUser: '94924171-e6b0-4076-8f54-71d4370af8ef',
    messageCount: 2,
    userRate: 'N/A',
    operationRate: 'N/A',
    updatedTime: '2023-03-21 10:25',
    createdTime: '2023-03-21 10:25',
    source: 'workflow',
    unread: true,
  },
  {
    id: 'log_011',
    title: 'Exploring options for customizing chatbot responses',
    endUser: '94924171-e6b0-4076-8f54-71d4370af8ef',
    messageCount: 2,
    userRate: 'N/A',
    operationRate: 'N/A',
    updatedTime: '2023-03-21 10:25',
    createdTime: '2023-03-21 10:25',
    source: 'webapp',
    unread: true,
  },
  {
    id: 'log_012',
    title: 'Understanding data management and security in Dify',
    endUser: '94924171-e6b0-4076-8f54-71d4370af8ef',
    messageCount: 2,
    userRate: 'N/A',
    operationRate: 'N/A',
    updatedTime: '2023-03-21 10:25',
    createdTime: '2023-03-21 10:25',
    source: 'workflow',
    unread: true,
  },
  {
    id: 'log_013',
    title: 'Learning about available resources for getting started with Dify',
    endUser: '94924171-e6b0-4076-8f54-71d4370af8ef',
    messageCount: 2,
    userRate: 'N/A',
    operationRate: 'N/A',
    updatedTime: '2023-03-21 10:25',
    createdTime: '2023-03-21 10:25',
    source: 'webapp',
    unread: true,
  },
  {
    id: 'log_014',
    title: 'What are the best practices for optimizing prompts?',
    endUser: '94924171-e6b0-4076-8f54-71d4370af8ef',
    messageCount: 2,
    userRate: 'N/A',
    operationRate: 'N/A',
    updatedTime: '2023-03-21 10:25',
    createdTime: '2023-03-21 10:25',
    source: 'workflow',
    unread: true,
  },
  {
    id: 'log_015',
    title: 'How do I monitor the performance of my AI applications?',
    endUser: '94924171-e6b0-4076-8f54-71d4370af8ef',
    messageCount: 2,
    userRate: 'N/A',
    operationRate: 'N/A',
    updatedTime: '2023-03-21 10:25',
    createdTime: '2023-03-21 10:25',
    source: 'webapp',
    unread: true,
  },
  {
    id: 'log_016',
    title: 'Is there a free trial available for Dify?',
    endUser: '94924171-e6b0-4076-8f54-71d4370af8ef',
    messageCount: 2,
    userRate: 'N/A',
    operationRate: 'N/A',
    updatedTime: '2023-03-21 10:25',
    createdTime: '2023-03-21 10:25',
    source: 'workflow',
    unread: true,
  },
  {
    id: 'log_017',
    title: 'How can I improve user satisfaction metrics with Dify?',
    endUser: '94924171-e6b0-4076-8f54-71d4370af8ef',
    messageCount: 2,
    userRate: 'N/A',
    operationRate: 'N/A',
    updatedTime: '2023-03-21 10:25',
    createdTime: '2023-03-21 10:25',
    source: 'webapp',
    unread: true,
  },
  {
    id: 'log_018',
    title: 'Are there any upcoming features or improvements in Dify?',
    endUser: '94924171-e6b0-4076-8f54-71d4370af8ef',
    messageCount: 2,
    userRate: 'N/A',
    operationRate: 'N/A',
    updatedTime: '2023-03-21 10:25',
    createdTime: '2023-03-21 10:25',
    source: 'workflow',
    unread: true,
  },
  {
    id: 'log_019',
    title: 'What are the recommended steps to deploy a Dify chatbot?',
    endUser: '94924171-e6b0-4076-8f54-71d4370af8ef',
    messageCount: 2,
    userRate: 'N/A',
    operationRate: 'N/A',
    updatedTime: '2023-03-21 10:25',
    createdTime: '2023-03-21 10:25',
    source: 'webapp',
    unread: true,
  },
]

const formatDateTime = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')

  return `${year}-${month}-${day} ${hour}:${minute}`
}

const formatLogTime = (index: number, offset: number) => {
  const logTime = new Date(baseLogTime)
  logTime.setMinutes(logTime.getMinutes() - index * LOG_INTERVAL_MINUTES - offset)

  return formatDateTime(logTime)
}

const getPeriodThreshold = (period: PeriodKey) => {
  const days = periodDays[period]

  if (!days)
    return undefined

  const threshold = new Date(baseLogTime)
  threshold.setDate(threshold.getDate() - days)

  return formatDateTime(threshold)
}

const logRows: AgentLogRow[] = Array.from({ length: LOG_ROW_COUNT }, (_, index) => {
  const template = logTemplates[index % logTemplates.length]!

  return {
    ...template,
    id: `${template.id}_${index + 1}`,
    messageCount: template.messageCount + (index % 4),
    updatedTime: formatLogTime(index, 0),
    createdTime: formatLogTime(index, 3),
  }
})

export function getOption<T extends string>(options: Array<FilterOption<T>>, value: T) {
  return options.find(option => option.value === value) ?? options[0]!
}

export function getSortParts(sortBy: string) {
  return {
    sortOrder: sortBy.startsWith('-') ? '-' : '',
    sortValue: sortBy.replace('-', '') || 'created_at',
  }
}

export function getAgentLogRowsView({
  period,
  source,
  keyword,
  sortBy,
  page,
  limit,
}: {
  period: PeriodKey
  source: SourceKey
  keyword: string
  sortBy: string
  page: number
  limit: number
}) {
  const normalizedKeyword = keyword.trim().toLowerCase()
  const periodThreshold = getPeriodThreshold(period)
  const filteredRows = logRows.filter((log) => {
    const matchesPeriod = !periodThreshold || log.createdTime >= periodThreshold
    const matchesSource = source === 'all' || log.source === source
    const matchesKeyword = !normalizedKeyword || [
      log.title,
      log.endUser,
      String(log.messageCount),
      log.updatedTime,
      log.createdTime,
    ].some(value => value.toLowerCase().includes(normalizedKeyword))

    return matchesPeriod && matchesSource && matchesKeyword
  })
  const { sortOrder, sortValue } = getSortParts(sortBy)
  const sortField = sortValue === 'updated_at' ? 'updatedTime' : 'createdTime'
  const sortDirection = sortOrder ? -1 : 1
  const sortedRows = [...filteredRows].sort((a, b) => {
    const timeSort = a[sortField].localeCompare(b[sortField]) * sortDirection

    if (timeSort !== 0)
      return timeSort

    return a.title.localeCompare(b.title) * sortDirection
  })
  const totalPages = Math.max(Math.ceil(sortedRows.length / limit), 1)
  const currentPage = Math.min(page, totalPages)

  return {
    currentPage,
    totalPages,
    rows: sortedRows.slice((currentPage - 1) * limit, currentPage * limit),
  }
}
