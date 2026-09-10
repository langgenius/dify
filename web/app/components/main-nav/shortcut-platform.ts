import type { detectPlatform } from '@tanstack/react-hotkeys'
import Bowser from 'bowser'

export type ShortcutPlatform = ReturnType<typeof detectPlatform>

export function getPlatformFromUserAgent(userAgent: string | null): ShortcutPlatform | null {
  if (!userAgent) return null
  const { name } = Bowser.getParser(userAgent).getOS()
  if (name === 'macOS' || name === 'iOS') return 'mac'
  if (name === 'Windows') return 'windows'
  // Hotkeys uses the Linux modifier layout for other non-Apple platforms too.
  return name ? 'linux' : null
}
