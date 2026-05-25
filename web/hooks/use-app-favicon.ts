import type { AppIconType } from '@/types/app'
import { useEffect } from 'react'
import { appDefaultIconBackground } from '@/config'
import { searchEmoji } from '@/utils/emoji'
import { clearRuntimeFavicon, setRuntimeFavicon } from '@/utils/favicon'

type UseAppFaviconOptions = {
  enable?: boolean
  icon_type?: AppIconType | null
  icon?: string
  icon_background?: string | null
  icon_url?: string | null
}

function escapeSvgText(value: string) {
  return value.replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    '\'': '&apos;',
  })[char]!)
}

async function buildEmojiFavicon(
  icon?: string,
  iconBackground?: string | null,
) {
  const emoji = icon ? await searchEmoji(icon) : '🤖'
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
    + `<rect width="100%" height="100%" fill="${escapeSvgText(iconBackground || appDefaultIconBackground)}" rx="30" ry="30" />`
    + `<text x="12.5" y="1em" font-size="75">${escapeSvgText(String(emoji))}</text>`
    + '</svg>'

  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

export function useAppFavicon(options: UseAppFaviconOptions) {
  const {
    enable = true,
    icon_type = 'emoji',
    icon,
    icon_background,
    icon_url,
  } = options

  useEffect(() => {
    let cancelled = false

    const syncFavicon = async () => {
      if (!enable || (icon_type === 'image' && !icon_url) || (icon_type === 'emoji' && !icon)) {
        clearRuntimeFavicon('app')
        return
      }

      const isValidImageIcon = icon_type === 'image' && icon_url
      const href = isValidImageIcon
        ? icon_url
        : await buildEmojiFavicon(icon, icon_background)

      if (cancelled)
        return

      setRuntimeFavicon('app', href, {
        type: isValidImageIcon ? undefined : 'image/svg+xml',
      })
    }

    void syncFavicon()

    return () => {
      cancelled = true
      clearRuntimeFavicon('app')
    }
  }, [enable, icon_type, icon, icon_background, icon_url])
}
