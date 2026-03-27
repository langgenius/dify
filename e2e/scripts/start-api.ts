import {
  apiDir,
  apiEnvExampleFile,
  isMainModule,
  readSimpleDotenv,
  runCommandOrThrow,
  runForegroundProcess,
} from './common'

const getApiEnvironment = async () => {
  const envFromExample = await readSimpleDotenv(apiEnvExampleFile)

  return {
    ...envFromExample,
    FLASK_APP: 'app.py',
  }
}

export const startApi = async () => {
  const env = await getApiEnvironment()

  await runCommandOrThrow({
    command: 'uv',
    args: ['run', '--project', '.', 'flask', 'upgrade-db'],
    cwd: apiDir,
    env,
  })

  await runForegroundProcess({
    command: 'uv',
    args: ['run', '--project', '.', 'flask', 'run', '--host', '127.0.0.1', '--port', '5001'],
    cwd: apiDir,
    env,
  })
}

const main = async () => {
  await startApi()
}

if (isMainModule(import.meta.url)) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
