import { isEqualOrLaterThanVersion } from './semver'

const SUPPORT_MCP_VERSION = '0.0.2'

export const isSupportMCP = (version?: string): boolean => {
  if (!version)
    return false

  return isEqualOrLaterThanVersion(version, SUPPORT_MCP_VERSION)
}
