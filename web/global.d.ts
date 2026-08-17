import './types/i18n'
import './types/jsx'
import './types/mdx'
import './types/assets'

declare global {
  // Google Analytics gtag types
  type GtagEventParams = {
    [key: string]: unknown
  }

  type Gtag = {
    (command: 'config', targetId: string, config?: GtagEventParams): void
    (command: 'event', eventName: string, eventParams?: GtagEventParams): void
    (command: 'js', date: Date): void
    (command: 'set', config: GtagEventParams): void
  }

  // eslint-disable-next-line ts/consistent-type-definitions -- interface required for declaration merging
  interface Window {
    gtag?: Gtag
    dataLayer?: unknown[]
    __marketplaceTracking__?: {
      track: (eventName: string, properties?: Record<string, unknown>) => void
      rememberReferrer: (
        itemId: string,
        section: 'banner' | 'search' | 'list' | 'direct',
      ) => void
      markSearch: (query: string) => void
      flushSearch: (resultCount: number) => void
      markFilter: (filter: {
        filter_type: 'type_tab' | 'category' | 'language'
        selection_mode: 'single' | 'multi'
        filter_value: string
        selected_values: string[]
      }) => void
      flushFilter: (resultCount: number) => void
    }
  }
}
