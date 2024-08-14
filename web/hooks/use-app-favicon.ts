import { useAsyncEffect } from 'ahooks'
import { appDefaultIconBackground } from '@/config'
import { searchEmoji } from '@/utils/emoji'

export function useAppFavicon(enable: boolean, icon?: string, icon_background?: string) {
  useAsyncEffect(async () => {
    if (!enable)
      return
    const link: HTMLLinkElement = document.querySelector('link[rel*="icon"]') || document.createElement('link')

    // eslint-disable-next-line prefer-template
    link.href = 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22>'
            + '<rect width=%22100%25%22 height=%22100%25%22 fill=%22' + encodeURIComponent(icon_background || appDefaultIconBackground) + '%22 rx=%2230%22 ry=%2230%22 />'
            + '<text x=%2212.5%22 y=%221em%22 font-size=%2275%22>'
            + (icon ? await searchEmoji(icon) : '🤖')
            + '</text>'
            + '</svg>'

    link.rel = 'shortcut icon'
    link.type = 'image/svg'
    document.getElementsByTagName('head')[0].appendChild(link)
  }, [enable, icon, icon_background])
}
