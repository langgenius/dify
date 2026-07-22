import type { HitlPausePayload } from './sse-collector'
import { colorEnabled, colorScheme } from '@/sys/io/color'

export type HitlExitObject = {
  status: 'paused'
  app_id: string
  task_id: string
  workflow_run_id: string
  form_id: string
  node_id: string
  node_title: string
  form_token: string | null
  approval_channels: string[]
  form_content: string
  inputs: unknown[]
  actions: unknown[]
  display_in_ui: boolean
  resolved_default_values: Record<string, string>
  expiration_time: number
}

export function buildHitlExitObject(appId: string, payload: HitlPausePayload): HitlExitObject {
  const d = payload.data
  return {
    status: 'paused',
    app_id: appId,
    task_id: payload.task_id,
    workflow_run_id: payload.workflow_run_id,
    form_id: d.form_id,
    node_id: d.node_id,
    node_title: d.node_title,
    form_token: d.form_token,
    approval_channels: d.approval_channels ?? [],
    form_content: d.form_content,
    inputs: d.inputs,
    actions: d.actions,
    display_in_ui: d.display_in_ui,
    resolved_default_values: d.resolved_default_values,
    expiration_time: d.expiration_time,
  }
}

export function renderHitlExit(obj: HitlExitObject): string {
  return JSON.stringify(obj, null, 2)
}

type ActionRecord = { id: string; title?: string; button_style?: string }
type InputRecord = {
  output_variable_name?: string
  label?: string
  type?: string
  required?: boolean
}

export function renderHitlBlock(_appId: string, payload: HitlPausePayload, isTTY: boolean): string {
  const d = payload.data
  const cs = colorScheme(colorEnabled(isTTY))
  const lines: string[] = []
  lines.push(`${cs.warningIcon()} ${cs.bold('Workflow paused')} ${cs.dim('— input required')}`)
  lines.push(`  ${cs.dim('Node:')}    ${d.node_title}`)
  const msgLines = d.form_content.split('\n')
  if (msgLines.length === 1) {
    lines.push(`  ${cs.dim('Message:')} ${d.form_content}`)
  } else {
    lines.push(`  ${cs.dim('Message:')}`)
    for (const ml of msgLines) lines.push(`    ${ml}`)
  }

  const actions = (Array.isArray(d.actions) ? d.actions : []) as ActionRecord[]
  if (actions.length > 0) {
    const inline = actions
      .map((a) => {
        const title = a.title ?? ''
        return `${cs.cyan(`[${a.id}]`)} ${title}`
      })
      .join('  ')
    lines.push(`  ${cs.dim('Actions:')} ${inline}`)
  }

  const inputs = (Array.isArray(d.inputs) ? d.inputs : []) as InputRecord[]
  if (inputs.length > 0) {
    const inline = inputs
      .map((inp) => {
        const name = inp.output_variable_name ?? '?'
        const label =
          typeof inp.label === 'string' && inp.label !== '' ? ` ${cs.dim(`— ${inp.label}`)}` : ''
        const req = inp.required === true ? ` ${cs.yellow('*')}` : ''
        return `- ${cs.cyan(name)}${req}${label}`
      })
      .join('  ')
    lines.push(`  ${cs.dim('Inputs:')}   ${inline}`)
  }

  lines.push('')
  return `${lines.join('\n')}\n`
}

export function renderHitlOutput(
  appId: string,
  payload: HitlPausePayload,
  isText: boolean,
  isOutTTY: boolean,
): string {
  if (isText) return renderHitlBlock(appId, payload, isOutTTY)
  const obj = buildHitlExitObject(appId, payload)
  return `${renderHitlExit(obj)}\n`
}

// Server approval-channel labels → human wording for the pause hint.
const APPROVAL_CHANNEL_LABELS: Record<string, string> = {
  email: 'email',
  console: 'the console',
  web_app: 'the web app',
}

function describeApprovalChannels(channels: string[]): string {
  const labels = channels.map((c) => APPROVAL_CHANNEL_LABELS[c] ?? c)
  if (labels.length <= 1) return labels[0] ?? 'another channel'
  if (labels.length === 2) return `${labels[0]} or ${labels[1]}`
  return `${labels.slice(0, -1).join(', ')}, or ${labels[labels.length - 1]}`
}

function externalChannelNote(channels: string[]): string {
  const where = channels.length > 1 ? 'those channels' : 'that channel'
  return `form delivered via ${describeApprovalChannels(channels)} — resume only from ${where}`
}

export function renderHitlHint(
  appId: string,
  payload: HitlPausePayload,
  isErrTTY: boolean,
): string {
  const d = payload.data
  const cs = colorScheme(colorEnabled(isErrTTY))
  if (d.form_token === null) {
    const note = externalChannelNote(d.approval_channels ?? [])
    if (!isErrTTY) return `hint: workflow paused — ${note}\n`
    return `${cs.warningIcon()} ${cs.bold('workflow paused')} — ${cs.dim(note)}\n`
  }
  const actions = (d.actions ?? []) as { id: string }[]
  let cmd = `difyctl resume app ${appId} ${d.form_token} --workflow-run-id ${payload.workflow_run_id}`
  if (actions.length > 1) {
    const firstAction = actions[0]?.id
    if (firstAction !== undefined) cmd += ` --action ${firstAction}`
  }
  if (!isErrTTY) return `hint: workflow paused — resume with: ${cmd}\n`
  return `${cs.warningIcon()} ${cs.bold('workflow paused')} — resume with:\n  ${cs.cyan(cmd)}\n`
}
