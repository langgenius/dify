type SemverIdentifier = number | string

type ParsedSemver = {
  core: number[]
  prerelease: SemverIdentifier[]
}

const parseIdentifier = (value: string): SemverIdentifier => {
  if (/^\d+$/.test(value))
    return Number(value)

  return value
}

const parseSemver = (version: string): ParsedSemver => {
  const normalized = version.trim().replace(/^v/i, '').split('+')[0]
  const [corePart, prereleasePart] = normalized.split('-', 2)

  return {
    core: corePart.split('.').map(part => Number(part) || 0),
    prerelease: prereleasePart
      ? prereleasePart.split('.').filter(Boolean).map(parseIdentifier)
      : [],
  }
}

const compareIdentifier = (left: SemverIdentifier, right: SemverIdentifier) => {
  if (typeof left === 'number' && typeof right === 'number')
    return Math.sign(left - right)

  if (typeof left === 'number')
    return -1

  if (typeof right === 'number')
    return 1

  return left.localeCompare(right)
}

const comparePrerelease = (left: SemverIdentifier[], right: SemverIdentifier[]) => {
  if (!left.length && !right.length)
    return 0

  if (!left.length)
    return 1

  if (!right.length)
    return -1

  const maxLength = Math.max(left.length, right.length)
  for (let i = 0; i < maxLength; i += 1) {
    const leftId = left[i]
    const rightId = right[i]

    if (leftId === undefined)
      return -1

    if (rightId === undefined)
      return 1

    const result = compareIdentifier(leftId, rightId)
    if (result !== 0)
      return result
  }

  return 0
}

export const compareVersion = (v1: string, v2: string) => {
  const left = parseSemver(v1)
  const right = parseSemver(v2)
  const maxCoreLength = Math.max(left.core.length, right.core.length)

  for (let i = 0; i < maxCoreLength; i += 1) {
    const diff = (left.core[i] || 0) - (right.core[i] || 0)
    if (diff !== 0)
      return Math.sign(diff)
  }

  return comparePrerelease(left.prerelease, right.prerelease)
}

export const gte = (v1: string, v2: string) => compareVersion(v1, v2) >= 0

export const lt = (v1: string, v2: string) => compareVersion(v1, v2) < 0

export const getLatestVersion = (versionList: string[]) => {
  return [...versionList].sort((left, right) => compareVersion(right, left))[0]
}

export const isEqualOrLaterThanVersion = (baseVersion: string, targetVersion: string) => {
  return gte(baseVersion, targetVersion)
}
