import { dockerDir, isMainModule, middlewareComposeFile, runCommandOrThrow } from './common'

const composeArgs = [
  'compose',
  '-f',
  middlewareComposeFile,
  '--profile',
  'postgresql',
  '--profile',
  'weaviate',
]

export const stopMiddleware = async () => {
  await runCommandOrThrow({
    command: 'docker',
    args: [...composeArgs, 'down', '--remove-orphans'],
    cwd: dockerDir,
  })
}

const main = async () => {
  await stopMiddleware()
}

if (isMainModule(import.meta.url)) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
