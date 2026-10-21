/** The errno codes the CLI branches on. */
export const ERRNO = {
  NotFound: 'ENOENT',
  Exists: 'EEXIST',
  NotADirectory: 'ENOTDIR',
} as const

/** Open flag that fails instead of replacing an existing file. */
export const CREATE_ONLY = 'wx'

export function errnoOf(cause: unknown): string | undefined {
  return (cause as NodeJS.ErrnoException | undefined)?.code
}
