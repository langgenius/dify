import type { HostsBundle } from '../auth/hosts.js'
import { BaseError } from '../errors/base.js'
import { ErrorCode } from '../errors/codes.js'

export type WorkspaceResolveInputs = {
  readonly flag?: string
  readonly env?: string
  readonly bundle?: HostsBundle
}

export function resolveWorkspaceId(inputs: WorkspaceResolveInputs): string {
  if (truthy(inputs.flag))
    return inputs.flag
  if (truthy(inputs.env))
    return inputs.env
  const b = inputs.bundle
  if (b !== undefined) {
    if (truthy(b.workspace?.id))
      return b.workspace.id
    if (b.available_workspaces !== undefined && b.available_workspaces.length > 0
      && truthy(b.available_workspaces[0]?.id)) {
      return b.available_workspaces[0].id
    }
  }
  throw new BaseError({
    code: ErrorCode.UsageMissingArg,
    message: 'no workspace selected',
    hint: 'pass --workspace, set DIFY_WORKSPACE_ID, or run \'difyctl auth use\'',
  })
}

function truthy(v: string | undefined): v is string {
  return v !== undefined && v !== ''
}
