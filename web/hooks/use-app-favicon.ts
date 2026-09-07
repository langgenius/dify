import type { AppIconType } from '@/types/app'
import { useEffect } from 'react'
import { appDefaultIconBackground } from '@/config'
import { searchEmoji } from '@/utils/emoji'

type UseAppFaviconOptions = {
  enable?: boolean
  icon_type?: AppIconType | null
  icon?: string
  icon_background?: string | null
  icon_url?: string | null
}

export function useAppFavicon(options: UseAppFaviconOptions) {
  const { enable = true, icon_type = 'emoji', icon, icon_background, icon_url } = options

  useEffect(() => {
    let cancelled = false
    let favicon: HTMLLinkElement | null = null

    const syncFavicon = async () => {
      let href: string | null | undefined
      let type: string | undefined

      if (icon_type === 'image') {
        href = icon_url
      } else if (icon_type === 'link') {
        href = icon
      } else if (icon_type !== 'emoji' || icon) {
        const emoji = icon ? await searchEmoji(icon) : '🤖'
        href =
          'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22>' +
          `<rect width=%22100%25%22 height=%22100%25%22 fill=%22${encodeURIComponent(icon_background || appDefaultIconBackground)}%22 rx=%2230%22 ry=%2230%22 />` +
          `<text x=%2212.5%22 y=%221em%22 font-size=%2275%22>${emoji}</text>` +
          '</svg>'
        type = 'image/svg+xml'
      }

      if (cancelled || !href) return

      favicon = document.createElement('link')
      favicon.dataset.difyAppFavicon = ''
      favicon.rel = 'icon'
      favicon.href = href
      if (type) favicon.type = type
      document.head.appendChild(favicon)
    }

    if (enable) void syncFavicon()

    return () => {
      cancelled = true
      favicon?.remove()
    }
  }, [enable, icon, icon_background, icon_type, icon_url])
}
