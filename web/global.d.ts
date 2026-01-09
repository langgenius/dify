import './types/i18n'
import './types/jsx'
import './types/mdx'
import './types/assets'

declare module 'lamejs';
declare module 'lamejs/src/js/MPEGMode';
declare module 'lamejs/src/js/Lame';
declare module 'lamejs/src/js/BitStream';
declare module 'react-18-input-autosize';

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
  }
}
