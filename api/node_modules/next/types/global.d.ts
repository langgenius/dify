/// <reference types="node" />

// Extend the NodeJS namespace with Next.js-defined properties
declare namespace NodeJS {
  // only for rust, see https://github.com/napi-rs/napi-rs/issues/1630
  interface TTY {
    setBlocking(blocking: boolean): void
  }

  interface WriteStream {
    _handle?: TTY
  }

  interface Process {
    /**
     * @deprecated Use `typeof window` instead
     */
    readonly browser: boolean
  }

  interface ProcessEnv {
    readonly NODE_ENV: 'development' | 'production' | 'test'
  }

  interface RequestInit extends globalThis.RequestInit {
    next?: NextFetchRequestConfig | undefined
  }
}

declare module '*.module.css' {
  const classes: { readonly [key: string]: string }
  export default classes
}

declare module '*.module.sass' {
  const classes: { readonly [key: string]: string }
  export default classes
}

declare module '*.module.scss' {
  const classes: { readonly [key: string]: string }
  export default classes
}

interface Window {
  MSInputMethodContext?: unknown
  /** @internal */
  __NEXT_HMR_CB?: null | ((message?: string) => void)
  /** @internal */
  __next_root_layout_missing_tags?: ('html' | 'body')[]
}

interface NextFetchRequestConfig {
  revalidate?: number | false
  tags?: string[]
}

interface RequestInit {
  next?: NextFetchRequestConfig | undefined
}

declare var _N_E_STYLE_LOAD: (href: string) => Promise<void>
