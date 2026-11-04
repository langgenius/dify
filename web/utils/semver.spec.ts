import {
  compareVersion,
  getLatestVersion,
  isEarlierThanVersion,
  isEqualOrLaterThanVersion,
} from './semver'

it('selects the newest stable version while preserving its original spelling and input order', () => {
  const versions = ['1.0.9', 'v1.0.11', '1.0.11-rc.1', '1.0.10']
  expect(getLatestVersion(versions)).toBe('v1.0.11')
  expect(versions).toEqual(['1.0.9', 'v1.0.11', '1.0.11-rc.1', '1.0.10'])
})

it.each([
  { base: '2.0.0', target: '1.9.9', comparison: 1, earlier: false, atLeast: true },
  { base: '1.0.0', target: '1.0.0', comparison: 0, earlier: false, atLeast: true },
  { base: '1.0.0-beta', target: '1.0.0', comparison: -1, earlier: true, atLeast: false },
])(
  'preserves comparison direction for $base and $target',
  ({ base, target, comparison, earlier, atLeast }) => {
    expect(compareVersion(base, target)).toBe(comparison)
    expect(isEarlierThanVersion(base, target)).toBe(earlier)
    expect(isEqualOrLaterThanVersion(base, target)).toBe(atLeast)
  },
)
