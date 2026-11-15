import type { ExternalTestStatusResponse } from '@dify/contracts/api/console/external-agents/types.gen'
import type { ExternalAgentOverview } from '../../model'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { render } from 'vitest-browser-react'
import { AppToaster } from '@/app/notifications/app-toaster'
import agentRoster from '@/i18n/locales/en-US/agent-roster.json'
import common from '@/i18n/locales/en-US/common.json'
import workflow from '@/i18n/locales/en-US/workflow.json'
import { createExternalAgentDetail } from '@/test/console/external-agents'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { toExternalAgentOverview } from '../../model'
import { ExternalAgentTestPanel } from '../test-run'

export const agentId = '22222222-2222-4222-8222-222222222222'
export const anchorId = '88888888-8888-4888-8888-888888888888'
export const childId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
export function testResult(
  state = 'waiting',
  overrides: Partial<ExternalTestStatusResponse> = {},
): ExternalTestStatusResponse {
  return {
    invocation_id: anchorId,
    state,
    outputs: state === 'succeeded' ? { text: 'Result supplied by the agent.' } : null,
    error_code: null,
    error_message: null,
    metadata: {
      agent_id: agentId,
      anchor_invocation_id: anchorId,
      test_generation: 1,
      cancellation_state: 'none',
    },
    ...overrides,
  }
}
export function testOverview(tracing = false) {
  const detail = createExternalAgentDetail()
  return toExternalAgentOverview({
    ...detail,
    asset: { ...detail.asset, tracing_enabled: tracing },
  })
}
export async function renderTestPanel(overview = testOverview()) {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { agentRoster, common, workflow } },
    keySeparator: false,
    interpolation: { escapeValue: false },
  })
  const { queryClient, wrapper: QueryProvider } = createConsoleQueryWrapper({
    currentWorkspace: { role: 'owner' },
  })
  const ui = (value: ExternalAgentOverview) => (
    <QueryProvider>
      <I18nextProvider i18n={i18n}>
        <ExternalAgentTestPanel overview={value} />
        <AppToaster timeout={0} />
      </I18nextProvider>
    </QueryProvider>
  )
  const rendered = await render(ui(overview))
  return {
    ...rendered,
    queryClient,
    rerenderOverview: (value: ExternalAgentOverview) => rendered.rerender(ui(value)),
  }
}
