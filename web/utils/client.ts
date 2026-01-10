/**
 * Server/Client environment detection utilities
 *
 * Use these constants and functions to safely detect the runtime environment
 * in Next.js applications where code may execute on both server and client.
 */

/**
 * Check if code is running on server-side (SSR)
 *
 * @example
 * if (isServer) {
 *   // Server-only logic
 * }
 */
export const isServer = typeof window === 'undefined'

/**
 * Check if code is running on client-side (browser)
 *
 * @example
 * if (isClient) {
 *   localStorage.setItem('key', 'value')
 * }
 */
export const isClient = typeof window !== 'undefined'
