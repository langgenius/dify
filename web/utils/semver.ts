import { compare, isGreaterThanOrEqual, isLessThan } from 'verkit'

export const getLatestVersion = (versionList: string[]) => {
  return [...versionList].sort((versionA, versionB) => {
    return compare(versionB, versionA)
  })[0]
}

export const compareVersion = (v1: string, v2: string) => {
  return compare(v1, v2)
}

export const isEqualOrLaterThanVersion = (baseVersion: string, targetVersion: string) => {
  return isGreaterThanOrEqual(baseVersion, targetVersion)
}

export const isEarlierThanVersion = (baseVersion: string, targetVersion: string) => {
  return isLessThan(baseVersion, targetVersion)
}
