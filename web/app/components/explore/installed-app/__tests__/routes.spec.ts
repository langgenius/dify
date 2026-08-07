import { describe, expect, it } from 'vitest'
import { buildInstalledAppPath, buildLegacyInstalledAppPath, isInstalledAppPath } from '../routes'

describe('installed app routes', () => {
  it('builds the canonical and legacy installed app paths', () => {
    expect(buildInstalledAppPath('installed-1')).toBe('/installed/installed-1')
    expect(buildLegacyInstalledAppPath('installed-1')).toBe('/explore/installed/installed-1')
  })

  it('matches canonical and legacy installed app routes', () => {
    expect(isInstalledAppPath('/installed/installed-1')).toBe(true)
    expect(isInstalledAppPath('/installed/installed-1/chat')).toBe(true)
    expect(isInstalledAppPath('/explore/installed/installed-1')).toBe(true)
    expect(isInstalledAppPath('/explore/installed/installed-1/chat')).toBe(true)
    expect(isInstalledAppPath('/explore/apps')).toBe(false)
  })

  it('can match a specific installed app id', () => {
    expect(isInstalledAppPath('/installed/installed-1', 'installed-1')).toBe(true)
    expect(isInstalledAppPath('/explore/installed/installed-1', 'installed-1')).toBe(true)
    expect(isInstalledAppPath('/installed/installed-2', 'installed-1')).toBe(false)
  })
})
