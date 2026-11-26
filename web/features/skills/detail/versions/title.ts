import type { SkillVersionResponse } from '@dify/contracts/api/console/workspaces/types.gen'

export function getSkillVersionTitle(version: SkillVersionResponse) {
  const versionName = version.version_name.trim()
  return versionName || `#${version.version_number}`
}
