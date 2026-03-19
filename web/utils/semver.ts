import { compare, gte, lt } from 'semver'

export const getLatestVersion = (versionList: string[]) => {
  return [...versionList].sort((versionA, versionB) => {
    return compare(versionB, versionA)
  })[0]
}

export const compareVersion = (v1: string, v2: string) => {
  return compare(v1, v2)
}

export const isEqualOrLaterThanVersion = (baseVersion: string, targetVersion: string) => {
  return gte(baseVersion, targetVersion)
}

export const isEarlierThanVersion = (baseVersion: string, targetVersion: string) => {
  return lt(baseVersion, targetVersion)
}
