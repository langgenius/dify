declare module '*.mdx' {
  import type { ComponentType } from 'react'
  const Component: ComponentType<{ apiBaseUrl: string }>
  export default Component
}
