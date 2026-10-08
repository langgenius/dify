import type { AppMode } from '@dify/contracts/api/console/apps/types.gen'
import type { NetworkAccessPoint } from '@/app/components/app/access-point/access-control/network-access'
import { trackEvent } from '@/app/components/base/amplitude'

export type AccessControlAnalyticsContext = {
  app_id: string
  app_mode: AppMode
  access_point_total: number
}

export type IpPolicySource =
  | 'list_add_button'
  | 'list_empty_state'
  | 'list_row'
  | 'list_row_menu'
  | 'access_control_dropdown'
  | 'access_control_empty_state'

export type IpPolicyValidationError =
  | 'octet_out_of_range'
  | 'leading_zero'
  | 'invalid_ipv6'
  | 'prefix_not_number'
  | 'prefix_out_of_range'
  | 'multiple_slash'
  | 'unsupported_format'

export type IpPolicyFormContext = {
  mode: 'create' | 'edit' | 'view'
  policy_id?: string
} & (
  | { source: Extract<IpPolicySource, `list_${string}`> }
  | ({ source: Extract<IpPolicySource, `access_control_${string}`> } & Pick<
      AccessControlAnalyticsContext,
      'app_id' | 'app_mode'
    >)
)

type AccessControlInteraction =
  | { action: 'edit_started'; edit_entry: 'first_config' | 'preview_edit' | 'draft_restored' }
  | { action: 'edit_abandoned'; abandon_method: 'cancel' | 'back' | 'dismiss' }
  | { action: 'manage_policies_clicked' }
  | {
      action:
        | 'policy_selected'
        | 'turned_on'
        | 'turn_off_attempted'
        | 'turn_off_confirmed'
        | 'turn_off_cancelled'
      policy_id: string
    }

export type AccessControlSaveProperties = AccessControlAnalyticsContext & {
  is_first_config: boolean
  policy_id: string
  protected_access_points: Array<'web_app' | 'service_api' | 'mcp_server' | 'trigger'>
  protected_count: number
  is_current_ip_included: boolean
}

export type IpPolicySaveProperties = IpPolicyFormContext & {
  mode: 'create' | 'edit'
  entry_count: number
  validation_error_types: IpPolicyValidationError[]
}

type AccessControlFailReason = 'network' | 'permission' | 'plan' | 'other'
type IpPolicyFailReason = 'limit_exceeded' | 'network' | 'permission' | 'other'
type SaveResult<Reason> = { result: 'success' } | { result: 'failed'; fail_reason: Reason }
type NetworkAccessEvents = {
  access_control_entry_click: AccessControlAnalyticsContext & {
    entry_status: 'off' | 'paused' | 'on' | 'partial' | 'sandbox' | 'lapsed'
    has_draft: boolean
  }
  access_control_upgrade_click: AccessControlAnalyticsContext & { plan_state: 'sandbox' | 'lapsed' }
  access_control_interaction: AccessControlAnalyticsContext & AccessControlInteraction
  access_control_save: AccessControlSaveProperties & SaveResult<AccessControlFailReason>
  ip_policy_save: IpPolicySaveProperties & SaveResult<IpPolicyFailReason>
  ip_policy_interaction:
    | { action: 'settings_tab_viewed' }
    | ({ action: 'form_opened' } & IpPolicyFormContext)
    | { action: 'delete_attempted' | 'delete_cancelled'; policy_id: string }
    | { action: 'delete_confirmed'; policy_id: string; referenced_app_count: number }
}

const APP_PROPERTIES = ['app_id', 'app_mode', 'access_point_total']
const EVENT_PROPERTIES = {
  access_control_entry_click: [...APP_PROPERTIES, 'entry_status', 'has_draft'],
  access_control_upgrade_click: [...APP_PROPERTIES, 'plan_state'],
  access_control_interaction: [
    ...APP_PROPERTIES,
    'action',
    'edit_entry',
    'abandon_method',
    'policy_id',
  ],
  access_control_save: [
    ...APP_PROPERTIES,
    'result',
    'is_first_config',
    'policy_id',
    'protected_access_points',
    'protected_count',
    'is_current_ip_included',
    'fail_reason',
  ],
  ip_policy_save: [
    'mode',
    'source',
    'result',
    'policy_id',
    'entry_count',
    'validation_error_types',
    'fail_reason',
  ],
  ip_policy_interaction: ['action', 'mode', 'source', 'policy_id', 'referenced_app_count'],
} satisfies Record<keyof NetworkAccessEvents, string[]>

export function trackNetworkAccessEvent<Event extends keyof NetworkAccessEvents>(
  event: Event,
  properties: NetworkAccessEvents[Event],
) {
  const allowed = EVENT_PROPERTIES[event]
  const fromApp =
    'source' in properties &&
    (properties.source === 'access_control_dropdown' ||
      properties.source === 'access_control_empty_state')
  const keys = fromApp ? [...allowed, 'app_id', 'app_mode'] : allowed
  const payload = Object.fromEntries(
    Object.entries(properties).filter(([key, value]) => keys.includes(key) && value !== undefined),
  )
  trackEvent(event, payload)
}

const ACCESS_POINTS = {
  webapp: 'web_app',
  service_api: 'service_api',
  mcp: 'mcp_server',
  trigger: 'trigger',
} as const

export function getProtectedAccessPoints(points: readonly NetworkAccessPoint[]) {
  return points.map((point) => ACCESS_POINTS[point])
}

async function readFailure(
  error: unknown,
): Promise<{ status?: number; message?: string; code?: string }> {
  if (typeof error !== 'object' || error === null) return {}
  const response =
    error instanceof Response
      ? error
      : 'response' in error && error.response instanceof Response
        ? error.response
        : undefined
  if (response) {
    try {
      const data: unknown = await response.clone().json()
      return { ...(await readFailure(data)), status: response.status }
    } catch {
      return { status: response.status }
    }
  }
  return {
    status: 'status' in error && typeof error.status === 'number' ? error.status : undefined,
    message: 'message' in error && typeof error.message === 'string' ? error.message : undefined,
    code: 'code' in error && typeof error.code === 'string' ? error.code : undefined,
  }
}

function isNetworkFailure(error: unknown, status?: number) {
  return (
    (status !== undefined && [408, 502, 503, 504].includes(status)) ||
    (status === undefined &&
      error instanceof Error &&
      ['TypeError', 'TimeoutError', 'AbortError'].includes(error.name))
  )
}

export async function getAccessControlFailReason(error: unknown): Promise<AccessControlFailReason> {
  const { status, message } = await readFailure(error)
  if (
    status === 403 &&
    (message === 'This feature requires a paid plan.' ||
      message === 'Network access groups are not available for this workspace.')
  )
    return 'plan'
  if (status === 401 || status === 403) return 'permission'
  return isNetworkFailure(error, status) ? 'network' : 'other'
}

export async function getIpPolicyFailReason(error: unknown): Promise<IpPolicyFailReason> {
  const { status, message, code } = await readFailure(error)
  if (
    status === 409 &&
    (code === 'NETWORK_ACCESS_GROUP_LIMIT' ||
      message === 'This workspace has reached the network access group limit.')
  )
    return 'limit_exceeded'
  if (status === 401 || status === 403) return 'permission'
  return isNetworkFailure(error, status) ? 'network' : 'other'
}
