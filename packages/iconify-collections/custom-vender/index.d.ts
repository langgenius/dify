export type IconifyJSON = {
  prefix: string
  icons: Record<string, IconifyIcon>
  aliases?: Record<string, IconifyAlias>
  width?: number
  height?: number
  lastModified?: number
}

export type IconifyIcon = {
  body: string
  left?: number
  top?: number
  width?: number
  height?: number
  rotate?: 0 | 1 | 2 | 3
  hFlip?: boolean
  vFlip?: boolean
}

export type IconifyAlias = {
  parent: string
} & Omit<IconifyIcon, 'body'>

export type IconifyInfo = {
  prefix: string
  name: string
  total: number
  version: string
  author?: {
    name: string
    url?: string
  }
  license?: {
    title: string
    spdx?: string
    url?: string
  }
  samples?: string[]
  palette?: boolean
}

export type IconifyMetaData = {
  [key: string]: unknown
}

export type IconifyChars = {
  [key: string]: string
}

export declare const icons: IconifyJSON
export declare const info: IconifyInfo
export declare const metadata: IconifyMetaData
export declare const chars: IconifyChars
