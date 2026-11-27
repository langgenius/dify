import type { ExternalTestStatusResponse } from '@dify/contracts/api/console/external-agents/types.gen'
import type { TFunction } from 'i18next'

/** Only structured evidence of a received reply can attribute this failure to the external agent. */
export function externalAgentReplyError(
  result: ExternalTestStatusResponse | undefined,
  t: TFunction<['agentRoster', 'common']>,
) {
  if (
    result?.state !== 'failed' ||
    !['invalid_message', 'invalid_response', 'invalid_stream_event'].includes(
      result.error_code ?? '',
    )
  )
    return undefined
  const issue = result.metadata.response_issue
  if (
    !issue ||
    typeof issue !== 'object' ||
    Array.isArray(issue) ||
    !('source' in issue) ||
    issue.source !== 'external_agent_reply' ||
    !('code' in issue) ||
    typeof issue.code !== 'string' ||
    !issue.code
  )
    return undefined

  switch (issue.code) {
    case 'message_context_id_missing':
      return t(($) => $['external.overview.testRun.responseContextMissing'])
    case 'message_context_id_invalid':
      return t(($) => $['external.overview.testRun.responseContextInvalid'])
    case 'message_role_missing':
      return `${t(($) => $['external.overview.testRun.responseRoleMissing'])} ${t(($) => $['external.overview.testRun.responseRoleField'])}`
    case 'message_role_invalid':
      return `${t(($) => $['external.overview.testRun.responseRoleInvalid'])} ${t(($) => $['external.overview.testRun.responseRoleField'])}`
    case 'message_context_id_and_role_invalid':
      return `${t(($) => $['external.overview.testRun.responseContextAndRoleInvalid'])} ${t(($) => $['external.overview.testRun.responseRoleField'])}`
    default:
      // A known source confirms receipt; future codes cannot expose remote values or prose.
      return t(($) => $['external.overview.testRun.responseInvalid'])
  }
}
