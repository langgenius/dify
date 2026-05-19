import { compare, greaterOrEqual, lessThan, parse } from 'std-semver'

const parseVersion = (version: string) => parse(version)

export const getLatestVersion = (versionList: string[]) => {
  return [...versionList].sort((versionA, versionB) => {
    return compare(parseVersion(versionB), parseVersion(versionA))
  })[0]
}

export const compareVersion = (v1: string, v2: string) => {
  return compare(parseVersion(v1), parseVersion(v2))
}

export const isEqualOrLaterThanVersion = (baseVersion: string, targetVersion: string) => {
  return greaterOrEqual(parseVersion(baseVersion), parseVersion(targetVersion))
}

export const isEarlierThanVersion = (baseVersion: string, targetVersion: string) => {
  return lessThan(parseVersion(baseVersion), parseVersion(targetVersion))
}
