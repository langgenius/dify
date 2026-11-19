import type {
  ExternalMetricValuesResponse,
  ExternalMonitoringResponse,
  ExternalTracingConfigurationResponse,
  ExternalTracingProviderOverviewResponse,
} from '@dify/contracts/api/console/external-agents/types.gen'
import { createInstance } from 'i18next'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { I18nextProvider } from 'react-i18next'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import agentRoster from '@/i18n/locales/en-US/agent-roster.json'
import agentV2 from '@/i18n/locales/en-US/agent-v-2.json'
import app from '@/i18n/locales/en-US/app.json'
import common from '@/i18n/locales/en-US/common.json'
import time from '@/i18n/locales/en-US/time.json'
import { createExternalAgentAsset } from '@/test/console/external-agents'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { ExternalAgentMonitoringPage } from '../page'

export const agentId = createExternalAgentAsset().id
export const appId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const apps: NonNullable<ExternalMonitoringResponse['apps']> = [
  { id: appId, name: 'Procurement Contract Review', type: 'workflow' },
]
export function metrics(
  overrides: Partial<ExternalMetricValuesResponse> = {},
): ExternalMetricValuesResponse {
  return {
    calls: 41,
    reported_tokens: 8200,
    average_call_duration: 12.5,
    token_reporting_coverage: 0.5,
    token_reporting_numerator: 20,
    token_reporting_denominator: 40,
    ...overrides,
  }
}
export function response(summary = metrics(), includeApps = true): ExternalMonitoringResponse {
  return {
    summary,
    days: [{ date: '2026-11-10', metrics: summary }],
    ...(includeApps ? { apps } : {}),
  }
}
export function configuration(
  overrides: Partial<ExternalTracingConfigurationResponse> = {},
): ExternalTracingConfigurationResponse {
  return {
    provider: 'langsmith',
    revision: 4,
    enabled: true,
    capture_content: false,
    configured_secrets: ['api_key'],
    values: { project: 'Saved production project', endpoint: 'https://api.smith.langchain.com' },
    ...overrides,
  }
}
export function providerOverview(
  configs: ExternalTracingConfigurationResponse[] = [],
): ExternalTracingProviderOverviewResponse {
  return {
    enabled_provider: configs.find((config) => config.enabled)?.provider ?? null,
    providers: configs.map(({ provider, revision, enabled, capture_content }) => ({
      provider,
      revision,
      enabled,
      capture_content,
    })),
  }
}
export async function renderMonitoring({
  role = 'owner',
  timezone = 'America/Los_Angeles',
}: { role?: 'owner' | 'normal'; timezone?: string } = {}) {
  await page.viewport(1512, 982)
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { agentRoster, agentV2, app, common, time } },
    keySeparator: false,
    interpolation: { escapeValue: false },
  })
  const { queryClient, wrapper: QueryProvider } = createConsoleQueryWrapper({
    currentWorkspace: { role },
    accountProfile: { timezone },
  })
  await render(
    <QueryProvider>
      <NuqsTestingAdapter hasMemory>
        <I18nextProvider i18n={i18n}>
          <div className="flex h-screen min-w-0 flex-col">
            <ExternalAgentMonitoringPage agentId={agentId} />
          </div>
        </I18nextProvider>
      </NuqsTestingAdapter>
    </QueryProvider>,
  )
  return queryClient
}
