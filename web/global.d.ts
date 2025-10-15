declare module 'lamejs';
declare module 'lamejs/src/js/MPEGMode';
declare module 'lamejs/src/js/Lame';
declare module 'lamejs/src/js/BitStream';
declare module 'react-18-input-autosize';

declare module '*.mdx' {
  let MDXComponent: (props: any) => JSX.Element
  export default MDXComponent
}

// Google Analytics gtag types
type GtagEventParams = {
  [key: string]: any
}

type Gtag = {
  (command: 'config', targetId: string, config?: GtagEventParams): void
  (command: 'event', eventName: string, eventParams?: GtagEventParams): void
  (command: 'js', date: Date): void
  (command: 'set', config: GtagEventParams): void
}

declare global {
  interface Window {
    gtag?: Gtag
    dataLayer?: any[]
  }
}

import './types/i18n'
