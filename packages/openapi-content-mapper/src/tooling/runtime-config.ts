import { existsSync } from 'node:fs'

export function runtimeConfigFile(fileName: string): string | undefined {
  const config = `${fileName}.config.ts`
  return existsSync(config.startsWith('file:') ? new URL(config) : config) ? config : undefined
}

export function operationConfigFile(
  fileName: string,
  kind: 'queries' | 'errors',
): string | undefined {
  const file = `${fileName}.${kind}.ts`
  return existsSync(file.startsWith('file:') ? new URL(file) : file) ? file : undefined
}
