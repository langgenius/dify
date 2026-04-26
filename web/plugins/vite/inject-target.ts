import path from 'node:path'

const rootClientInjectTargetRelativePath = 'instrumentation-client.ts'

export const getRootClientInjectTarget = (projectRoot: string): string => {
  return path.resolve(projectRoot, rootClientInjectTargetRelativePath)
}
