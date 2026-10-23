import { existsSync } from 'node:fs'

export function runtimeConfigFile(fileName: string): string | undefined {
  const config = `${fileName}.config.ts`
  return existsSync(config.startsWith('file:') ? new URL(config) : config) ? config : undefined
}
