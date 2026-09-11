import type { detectPlatform } from '@tanstack/react-hotkeys'
import UAParser from 'ua-parser-js'

export type ShortcutPlatform = ReturnType<typeof detectPlatform>

export function getPlatformFromUserAgent(userAgent: string | null): ShortcutPlatform | null {
  if (!userAgent) return null
  const { name } = new UAParser(userAgent).getOS()
  if (name === 'Mac OS' || name === 'iOS') return 'mac'
  if (name === 'Windows') return 'windows'
  // Hotkeys uses the Linux modifier layout for other non-Apple platforms too.
  return name ? 'linux' : null
}
