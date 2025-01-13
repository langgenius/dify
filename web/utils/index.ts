import { escape } from 'lodash-es'

export const sleep = (ms: number) => {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function asyncRunSafe<T = any>(fn: Promise<T>): Promise<[Error] | [null, T]> {
  try {
    return [null, await fn]
  }
  catch (e: any) {
    return [e || new Error('unknown error')]
  }
}

export const getTextWidthWithCanvas = (text: string, font?: string) => {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.font = font ?? '12px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"'
    return Number(ctx.measureText(text).width.toFixed(2))
  }
  return 0
}

const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_'

export function randomString(length: number) {
  let result = ''
  for (let i = length; i > 0; --i) result += chars[Math.floor(Math.random() * chars.length)]
  return result
}

export const getPurifyHref = (href: string) => {
  if (!href)
    return ''

  return escape(href)
}

export async function fetchWithRetry<T = any>(fn: Promise<T>, retries = 3): Promise<[Error] | [null, T]> {
  const [error, res] = await asyncRunSafe(fn)
  if (error) {
    if (retries > 0) {
      const res = await fetchWithRetry(fn, retries - 1)
      return res
    }
    else {
      if (error instanceof Error)
        return [error]
      return [new Error('unknown error')]
    }
  }
  else {
    return [null, res]
  }
}
