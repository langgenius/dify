// TypeScript type definitions for custom JSX elements
// Custom JSX elements for emoji-mart web components

import 'react'

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'em-emoji': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>
    }
  }
}
