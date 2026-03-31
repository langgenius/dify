'use client'

import type { TFunction } from 'i18next'
import type { FC } from 'react'
import type { IBizChartProps, PeriodParams } from './types'
import type { ChartDataResponse, ChartType } from './utils'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import {
  useAppAverageResponseTime,
  useAppAverageSessionInteractions,
  useAppDailyConversations,
  useAppDailyEndUsers,
  useAppDailyMessages,
  useAppSatisfactionRate,
  useAppTokenCosts,
  useAppTokensPerSecond,
  useWorkflowAverageInteractions,
  useWorkflowDailyConversations,
  useWorkflowDailyTerminals,
  useWorkflowTokenCosts,
} from '@/service/use-apps'
import Chart from './core'
import { defaultPeriod, getDefaultChartData, isChartDataEmpty } from './utils'

type MetricChartConfig = {
  displayName: string
  titleKey: string
  explanationKey: string
  chartType: ChartType
  valueKey?: string
  fallbackKey?: string
  isAvg?: boolean
  emptyYMax: number
  className?: string
  getUnit?: (translate: TFunction) => string
}

type MetricHook<Response extends ChartDataResponse> = (appId: string, params?: PeriodParams['query']) => {
  data?: Response
  isLoading: boolean
}

type MetricChartRendererProps = IBizChartProps & MetricChartConfig & {
  response?: ChartDataResponse
  isLoading: boolean
}

type MetricChartContainerProps<Response extends ChartDataResponse> = IBizChartProps & {
  useMetricHook: MetricHook<Response>
  config: MetricChartConfig
}

const translateMetricText = (translate: TFunction, key: string) => {
  return translate(key, key, { ns: 'appOverview' }) as string
}

const MetricChartRenderer: FC<MetricChartRendererProps> = ({
  period,
  response,
  isLoading,
  titleKey,
  explanationKey,
  chartType,
  valueKey,
  fallbackKey,
  isAvg,
  emptyYMax,
  className,
  getUnit,
}) => {
  const { t } = useTranslation()

  if (isLoading || !response)
    return <Loading />

  const noData = isChartDataEmpty(response)
  const chartData = noData
    ? {
        data: getDefaultChartData({
          ...(period.query ?? defaultPeriod),
          key: fallbackKey ?? valueKey ?? 'count',
        }),
      }
    : response

  return (
    <Chart
      basicInfo={{
        title: translateMetricText(t, titleKey),
        explanation: translateMetricText(t, explanationKey),
        timePeriod: period.name,
      }}
      chartData={chartData}
      chartType={chartType}
      valueKey={valueKey}
      isAvg={isAvg}
      unit={getUnit?.(t) ?? ''}
      className={className}
      {...(noData && { yMax: emptyYMax })}
    />
  )
}

const MetricChartContainer = <Response extends ChartDataResponse>({
  id,
  period,
  useMetricHook,
  config,
}: MetricChartContainerProps<Response>) => {
  const { data, isLoading } = useMetricHook(id, period.query)

  return (
    <MetricChartRenderer
      id={id}
      period={period}
      response={data}
      isLoading={isLoading}
      {...config}
    />
  )
}

const MESSAGES_CHART_CONFIG: MetricChartConfig = {
  displayName: 'MessagesChart',
  titleKey: 'analysis.totalMessages.title',
  explanationKey: 'analysis.totalMessages.explanation',
  chartType: 'messages',
  emptyYMax: 500,
}

const CONVERSATIONS_CHART_CONFIG: MetricChartConfig = {
  displayName: 'ConversationsChart',
  titleKey: 'analysis.totalConversations.title',
  explanationKey: 'analysis.totalConversations.explanation',
  chartType: 'conversations',
  emptyYMax: 500,
}

const END_USERS_CHART_CONFIG: MetricChartConfig = {
  displayName: 'EndUsersChart',
  titleKey: 'analysis.activeUsers.title',
  explanationKey: 'analysis.activeUsers.explanation',
  chartType: 'endUsers',
  emptyYMax: 500,
}

const AVG_SESSION_INTERACTIONS_CONFIG: MetricChartConfig = {
  displayName: 'AvgSessionInteractions',
  titleKey: 'analysis.avgSessionInteractions.title',
  explanationKey: 'analysis.avgSessionInteractions.explanation',
  chartType: 'conversations',
  valueKey: 'interactions',
  fallbackKey: 'interactions',
  isAvg: true,
  emptyYMax: 500,
}

const AVG_RESPONSE_TIME_CONFIG: MetricChartConfig = {
  displayName: 'AvgResponseTime',
  titleKey: 'analysis.avgResponseTime.title',
  explanationKey: 'analysis.avgResponseTime.explanation',
  chartType: 'conversations',
  valueKey: 'latency',
  fallbackKey: 'latency',
  isAvg: true,
  emptyYMax: 500,
  getUnit: translate => translate('analysis.ms', { ns: 'appOverview' }) as string,
}

const TOKEN_PER_SECOND_CONFIG: MetricChartConfig = {
  displayName: 'TokenPerSecond',
  titleKey: 'analysis.tps.title',
  explanationKey: 'analysis.tps.explanation',
  chartType: 'conversations',
  valueKey: 'tps',
  fallbackKey: 'tps',
  isAvg: true,
  emptyYMax: 100,
  className: 'min-w-0',
  getUnit: translate => translate('analysis.tokenPS', { ns: 'appOverview' }) as string,
}

const USER_SATISFACTION_RATE_CONFIG: MetricChartConfig = {
  displayName: 'UserSatisfactionRate',
  titleKey: 'analysis.userSatisfactionRate.title',
  explanationKey: 'analysis.userSatisfactionRate.explanation',
  chartType: 'endUsers',
  valueKey: 'rate',
  fallbackKey: 'rate',
  isAvg: true,
  emptyYMax: 1000,
  className: 'h-full',
}

const COST_CHART_CONFIG: MetricChartConfig = {
  displayName: 'CostChart',
  titleKey: 'analysis.tokenUsage.title',
  explanationKey: 'analysis.tokenUsage.explanation',
  chartType: 'costs',
  emptyYMax: 100,
}

const WORKFLOW_MESSAGES_CHART_CONFIG: MetricChartConfig = {
  displayName: 'WorkflowMessagesChart',
  titleKey: 'analysis.totalMessages.title',
  explanationKey: 'analysis.totalMessages.explanation',
  chartType: 'conversations',
  valueKey: 'runs',
  fallbackKey: 'runs',
  emptyYMax: 500,
}

const WORKFLOW_DAILY_TERMINALS_CHART_CONFIG: MetricChartConfig = {
  displayName: 'WorkflowDailyTerminalsChart',
  titleKey: 'analysis.activeUsers.title',
  explanationKey: 'analysis.activeUsers.explanation',
  chartType: 'endUsers',
  emptyYMax: 500,
}

const WORKFLOW_COST_CHART_CONFIG: MetricChartConfig = {
  displayName: 'WorkflowCostChart',
  titleKey: 'analysis.tokenUsage.title',
  explanationKey: 'analysis.tokenUsage.explanation',
  chartType: 'workflowCosts',
  emptyYMax: 100,
}

const AVG_USER_INTERACTIONS_CONFIG: MetricChartConfig = {
  displayName: 'AvgUserInteractions',
  titleKey: 'analysis.avgUserInteractions.title',
  explanationKey: 'analysis.avgUserInteractions.explanation',
  chartType: 'conversations',
  valueKey: 'interactions',
  fallbackKey: 'interactions',
  isAvg: true,
  emptyYMax: 500,
}

export const MessagesChart: FC<IBizChartProps> = props => (
  <MetricChartContainer {...props} useMetricHook={useAppDailyMessages} config={MESSAGES_CHART_CONFIG} />
)

export const ConversationsChart: FC<IBizChartProps> = props => (
  <MetricChartContainer {...props} useMetricHook={useAppDailyConversations} config={CONVERSATIONS_CHART_CONFIG} />
)

export const EndUsersChart: FC<IBizChartProps> = props => (
  <MetricChartContainer {...props} useMetricHook={useAppDailyEndUsers} config={END_USERS_CHART_CONFIG} />
)

export const AvgSessionInteractions: FC<IBizChartProps> = props => (
  <MetricChartContainer {...props} useMetricHook={useAppAverageSessionInteractions} config={AVG_SESSION_INTERACTIONS_CONFIG} />
)

export const AvgResponseTime: FC<IBizChartProps> = props => (
  <MetricChartContainer {...props} useMetricHook={useAppAverageResponseTime} config={AVG_RESPONSE_TIME_CONFIG} />
)

export const TokenPerSecond: FC<IBizChartProps> = props => (
  <MetricChartContainer {...props} useMetricHook={useAppTokensPerSecond} config={TOKEN_PER_SECOND_CONFIG} />
)

export const UserSatisfactionRate: FC<IBizChartProps> = props => (
  <MetricChartContainer {...props} useMetricHook={useAppSatisfactionRate} config={USER_SATISFACTION_RATE_CONFIG} />
)

export const CostChart: FC<IBizChartProps> = props => (
  <MetricChartContainer {...props} useMetricHook={useAppTokenCosts} config={COST_CHART_CONFIG} />
)

export const WorkflowMessagesChart: FC<IBizChartProps> = props => (
  <MetricChartContainer {...props} useMetricHook={useWorkflowDailyConversations} config={WORKFLOW_MESSAGES_CHART_CONFIG} />
)

export const WorkflowDailyTerminalsChart: FC<IBizChartProps> = props => (
  <MetricChartContainer {...props} useMetricHook={useWorkflowDailyTerminals} config={WORKFLOW_DAILY_TERMINALS_CHART_CONFIG} />
)

export const WorkflowCostChart: FC<IBizChartProps> = props => (
  <MetricChartContainer {...props} useMetricHook={useWorkflowTokenCosts} config={WORKFLOW_COST_CHART_CONFIG} />
)

export const AvgUserInteractions: FC<IBizChartProps> = props => (
  <MetricChartContainer {...props} useMetricHook={useWorkflowAverageInteractions} config={AVG_USER_INTERACTIONS_CONFIG} />
)
