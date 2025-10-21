import { compareVersion, getLatestVersion, isEqualOrLaterThanVersion } from './semver'

describe('semver utilities', () => {
  describe('getLatestVersion', () => {
    it('should return the latest version from a list of versions', () => {
      expect(getLatestVersion(['1.0.0', '1.1.0', '1.0.1'])).toBe('1.1.0')
      expect(getLatestVersion(['2.0.0', '1.9.9', '1.10.0'])).toBe('2.0.0')
      expect(getLatestVersion(['1.0.0-alpha', '1.0.0-beta', '1.0.0'])).toBe('1.0.0')
    })

    it('should handle patch versions correctly', () => {
      expect(getLatestVersion(['1.0.1', '1.0.2', '1.0.0'])).toBe('1.0.2')
      expect(getLatestVersion(['1.0.10', '1.0.9', '1.0.11'])).toBe('1.0.11')
    })

    it('should handle mixed version formats', () => {
      expect(getLatestVersion(['v1.0.0', '1.1.0', 'v1.2.0'])).toBe('v1.2.0')
      expect(getLatestVersion(['1.0.0-rc.1', '1.0.0', '1.0.0-beta'])).toBe('1.0.0')
    })

    it('should return the only version if only one version is provided', () => {
      expect(getLatestVersion(['1.0.0'])).toBe('1.0.0')
    })
  })

  describe('compareVersion', () => {
    it('should return 1 when first version is greater', () => {
      expect(compareVersion('1.1.0', '1.0.0')).toBe(1)
      expect(compareVersion('2.0.0', '1.9.9')).toBe(1)
      expect(compareVersion('1.0.1', '1.0.0')).toBe(1)
    })

    it('should return -1 when first version is less', () => {
      expect(compareVersion('1.0.0', '1.1.0')).toBe(-1)
      expect(compareVersion('1.9.9', '2.0.0')).toBe(-1)
      expect(compareVersion('1.0.0', '1.0.1')).toBe(-1)
    })

    it('should return 0 when versions are equal', () => {
      expect(compareVersion('1.0.0', '1.0.0')).toBe(0)
      expect(compareVersion('2.1.3', '2.1.3')).toBe(0)
    })

    it('should handle pre-release versions correctly', () => {
      expect(compareVersion('1.0.0-beta', '1.0.0-alpha')).toBe(1)
      expect(compareVersion('1.0.0', '1.0.0-beta')).toBe(1)
      expect(compareVersion('1.0.0-alpha', '1.0.0-beta')).toBe(-1)
    })
  })

  describe('isEqualOrLaterThanVersion', () => {
    it('should return true when baseVersion is greater than targetVersion', () => {
      expect(isEqualOrLaterThanVersion('1.1.0', '1.0.0')).toBe(true)
      expect(isEqualOrLaterThanVersion('2.0.0', '1.9.9')).toBe(true)
      expect(isEqualOrLaterThanVersion('1.0.1', '1.0.0')).toBe(true)
    })

    it('should return true when baseVersion is equal to targetVersion', () => {
      expect(isEqualOrLaterThanVersion('1.0.0', '1.0.0')).toBe(true)
      expect(isEqualOrLaterThanVersion('2.1.3', '2.1.3')).toBe(true)
    })

    it('should return false when baseVersion is less than targetVersion', () => {
      expect(isEqualOrLaterThanVersion('1.0.0', '1.1.0')).toBe(false)
      expect(isEqualOrLaterThanVersion('1.9.9', '2.0.0')).toBe(false)
      expect(isEqualOrLaterThanVersion('1.0.0', '1.0.1')).toBe(false)
    })

    it('should handle pre-release versions correctly', () => {
      expect(isEqualOrLaterThanVersion('1.0.0', '1.0.0-beta')).toBe(true)
      expect(isEqualOrLaterThanVersion('1.0.0-beta', '1.0.0-alpha')).toBe(true)
      expect(isEqualOrLaterThanVersion('1.0.0-alpha', '1.0.0')).toBe(false)
    })
  })
})
