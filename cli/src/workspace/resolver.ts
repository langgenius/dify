import type { ActiveContext } from '@/auth/hosts'
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'

export type WorkspaceResolveInputs = {
  readonly flag?: string
  readonly env?: string
  readonly active?: ActiveContext
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isValidUuid(v: string): boolean {
  return UUID_RE.test(v)
}

export function resolveWorkspaceId(inputs: WorkspaceResolveInputs): string {
  if (truthy(inputs.flag)) {
    if (!isValidUuid(inputs.flag))
      throw new BaseError({ code: ErrorCode.UsageInvalidFlag, message: `--workspace value ${JSON.stringify(inputs.flag)} is not a valid UUID` })
    return inputs.flag
  }
  if (truthy(inputs.env)) {
    if (!isValidUuid(inputs.env))
      throw new BaseError({ code: ErrorCode.UsageInvalidFlag, message: `DIFY_WORKSPACE_ID value ${JSON.stringify(inputs.env)} is not a valid UUID` })
    return inputs.env
  }
  const ctx = inputs.active?.ctx
  if (ctx !== undefined) {
    if (truthy(ctx.workspace?.id))
      return ctx.workspace.id
    if (ctx.available_workspaces !== undefined && ctx.available_workspaces.length > 0
      && truthy(ctx.available_workspaces[0]?.id)) {
      return ctx.available_workspaces[0].id
    }
  }
  throw new BaseError({
    code: ErrorCode.UsageMissingArg,
    message: 'no workspace selected',
    hint: 'pass --workspace, set DIFY_WORKSPACE_ID, or run \'difyctl use workspace <id>\'',
  })
}

function truthy(v: string | undefined): v is string {
  return v !== undefined && v !== ''
}
