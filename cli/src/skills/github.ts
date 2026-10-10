import type { SkillSource } from './source'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { buildFetchInit } from '@/net/fetch-init'
import { proxyDispatcher } from '@/net/proxy'
import { getEnv } from '@/sys'

export const GITHUB_ORIGIN = 'https://github.com'
const API_ORIGIN = 'https://api.github.com'
const RAW_ORIGIN = 'https://raw.githubusercontent.com'
const TREE_SEGMENT = 'tree'
const DEFAULT_REF = 'HEAD'
const TOKEN_ENV = 'GITHUB_TOKEN'
const RATE_LIMIT_HEADER = 'x-ratelimit-remaining'
const TOO_MANY_REQUESTS = 429
const EXECUTABLE_MODE = '100755'
const FILE_MODES: readonly string[] = ['100644', EXECUTABLE_MODE]
const FROM_HINT = 'check --from, or download the skills folder and pass --from <folder>'

const TREE_SCHEMA = z.object({
  truncated: z.boolean(),
  tree: z.array(z.object({ path: z.string(), mode: z.string(), sha: z.string() })),
})

export type GitHubFolder = {
  readonly owner: string
  readonly repo: string
  readonly ref: string
  readonly path: string
}

export function parseGitHubUrl(url: string): GitHubFolder {
  const [owner, repo, segment, ref, ...rest] = new URL(url).pathname.split('/').filter(Boolean)
  const tree = segment === undefined || (segment === TREE_SEGMENT && ref !== undefined)
  if (owner === undefined || repo === undefined || !tree) {
    throw new BaseError({
      code: ErrorCode.UsageInvalidFlag,
      message: `unsupported GitHub URL "${url}"`,
      hint: `use ${GITHUB_ORIGIN}/<owner>/<repo>/tree/<ref>/<folder>`,
    })
  }
  return { owner, repo, ref: ref ?? DEFAULT_REF, path: rest.join('/') }
}

async function get(url: string, token?: string): Promise<Response> {
  const headers = token === undefined ? undefined : { authorization: `Bearer ${token}` }
  let res: Response
  try {
    res = await fetch(
      url,
      buildFetchInit({ headers }, { insecure: false, dispatcher: proxyDispatcher() }),
    )
  } catch (cause) {
    throw new BaseError({
      code: ErrorCode.NetworkConnection,
      message: `GET ${url} failed`,
      hint: FROM_HINT,
      cause,
    })
  }
  if (res.ok) return res
  const limited = res.status === TOO_MANY_REQUESTS || res.headers.get(RATE_LIMIT_HEADER) === '0'
  throw new BaseError({
    code: limited ? ErrorCode.RateLimited : ErrorCode.ServerError,
    message: `GET ${url} returned ${res.status}`,
    hint: limited ? `set ${TOKEN_ENV} to raise GitHub's rate limit, or ${FROM_HINT}` : FROM_HINT,
  })
}

function gitBlobSha(bytes: Uint8Array): string {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
}

export async function openGitHub(url: string): Promise<SkillSource> {
  const { owner, repo, ref, path } = parseGitHubUrl(url)
  const treeUrl = `${API_ORIGIN}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(`${ref}:${path}`)}?recursive=1`
  const parsed = TREE_SCHEMA.safeParse(await (await get(treeUrl, getEnv(TOKEN_ENV))).json())
  if (!parsed.success)
    throw new BaseError({
      code: ErrorCode.ServerError,
      message: `unexpected response from ${treeUrl}`,
    })
  if (parsed.data.truncated) {
    throw new BaseError({
      code: ErrorCode.UsageInvalidFlag,
      message: `${url} holds too many files to list`,
      hint: 'point --from at the skills folder',
    })
  }
  const files = parsed.data.tree.filter((entry) => FILE_MODES.includes(entry.mode))
  const shas = new Map(files.map((entry) => [entry.path, entry.sha]))
  return {
    entries: files.map((entry) => ({
      path: entry.path,
      executable: entry.mode === EXECUTABLE_MODE,
    })),
    read: async (file) => {
      const rawUrl = [RAW_ORIGIN, owner, repo, ref, path, file].filter(Boolean).join('/')
      const bytes = new Uint8Array(await (await get(rawUrl)).arrayBuffer())
      if (gitBlobSha(bytes) !== shas.get(file)) {
        throw new BaseError({
          code: ErrorCode.ServerError,
          message: `${rawUrl} changed during the install`,
          hint: 'retry in a few minutes',
        })
      }
      return bytes
    },
  }
}
