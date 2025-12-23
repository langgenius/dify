import type { AppIconType } from '@/types/app'
import { useAsyncEffect } from 'ahooks'
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
  const {
    enable = true,
    icon_type = 'emoji',
    icon,
    icon_background,
    icon_url,
  } = options

  useAsyncEffect(async () => {
    if (!enable || (icon_type === 'image' && !icon_url) || (icon_type === 'emoji' && !icon))
      return

    const isValidImageIcon = icon_type === 'image' && icon_url

    const link: HTMLLinkElement = document.querySelector('link[rel*="icon"]') || document.createElement('link')

    link.href = isValidImageIcon
      ? icon_url
      : 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22>'
        + `<rect width=%22100%25%22 height=%22100%25%22 fill=%22${encodeURIComponent(icon_background || appDefaultIconBackground)}%22 rx=%2230%22 ry=%2230%22 />`
        + `<text x=%2212.5%22 y=%221em%22 font-size=%2275%22>${
          icon ? await searchEmoji(icon) : '🤖'
        }</text>`
        + '</svg>'

    link.rel = 'shortcut icon'
    link.type = 'image/svg'
    document.getElementsByTagName('head')[0].appendChild(link)
  }, [enable, icon, icon_background])
}
