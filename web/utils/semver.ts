import { compare, greaterOrEqual, lessThan, parse } from 'std-semver'

export const getLatestVersion = (versionList: string[]) => {
  return [...versionList].sort((versionA, versionB) => {
    return compare(parse(versionB), parse(versionA))
  })[0]
}

export const compareVersion = (v1: string, v2: string) => {
  return compare(parse(v1), parse(v2))
}

export const isEqualOrLaterThanVersion = (baseVersion: string, targetVersion: string) => {
  return greaterOrEqual(parse(baseVersion), parse(targetVersion))
}

export const isEarlierThanVersion = (baseVersion: string, targetVersion: string) => {
  return lessThan(parse(baseVersion), parse(targetVersion))
}
