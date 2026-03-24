import path from 'node:path'

export const rootClientInjectTargetRelativePath = 'app/routePrefixHandle.tsx'

export const getRootClientInjectTarget = (projectRoot: string): string => {
  return path.resolve(projectRoot, rootClientInjectTargetRelativePath)
}
