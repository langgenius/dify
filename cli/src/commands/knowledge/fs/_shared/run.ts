import type { ActiveContext } from '@/auth/hosts'
import type { HttpClient } from '@/http/types'
import type { IOStreams } from '@/sys/io/streams'
import { KnowledgeFsClient } from '@/api/knowledge-fs'
import { runWithSpinner } from '@/sys/io/spinner'
import { nullStreams } from '@/sys/io/streams'
import { resolveWorkspaceId } from '@/workspace/resolver'

export type KnowledgeFsCommandOptions = {
  readonly workspace?: string
  readonly knowledgeSpaceId: string
}

export type KnowledgeFsCommandDeps = {
  readonly active: ActiveContext
  readonly http: HttpClient
  readonly io?: IOStreams
  readonly envLookup?: (key: string) => string | undefined
  readonly knowledgeFsFactory?: (http: HttpClient) => KnowledgeFsClient
}

export type KnowledgeFsCommandRequest<T> = {
  readonly label: string
  readonly execute: (
    client: KnowledgeFsClient,
    workspaceId: string,
    knowledgeSpaceId: string,
  ) => Promise<T>
}

export async function runKnowledgeFsCommand<T>(
  opts: KnowledgeFsCommandOptions,
  deps: KnowledgeFsCommandDeps,
  request: KnowledgeFsCommandRequest<T>,
): Promise<{ readonly data: T; readonly workspaceId: string }> {
  const env = deps.envLookup ?? ((key: string) => process.env[key])
  const factory = deps.knowledgeFsFactory ?? ((http: HttpClient) => new KnowledgeFsClient(http))
  const io = deps.io ?? nullStreams()
  const workspaceId = resolveWorkspaceId({
    flag: opts.workspace,
    env: env('DIFY_WORKSPACE_ID'),
    active: deps.active,
  })

  const data = await runWithSpinner({ io, label: request.label }, () =>
    request.execute(factory(deps.http), workspaceId, opts.knowledgeSpaceId),
  )

  return { data, workspaceId }
}
