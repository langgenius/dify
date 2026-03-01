import semver from 'semver'

export const getLatestVersion = (versionList: string[]) => {
  return semver.rsort(versionList)[0]
}

export const compareVersion = (v1: string, v2: string) => {
  return semver.compare(v1, v2)
}

export const isEqualOrLaterThanVersion = (baseVersion: string, targetVersion: string) => {
  return semver.gte(baseVersion, targetVersion)
}
