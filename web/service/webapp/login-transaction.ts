const TRANSACTION_TTL = 30 * 60 * 1000

export function storeWebAppLoginTransaction(key: string, verifier: string, redirectUrl: string) {
  sessionStorage.setItem(key, JSON.stringify({ verifier, redirectUrl, createdAt: Date.now() }))
}

export function removeWebAppLoginTransaction(key: string) {
  try {
    sessionStorage.removeItem(key)
  } catch {}
}

export function readWebAppLoginTransaction(key: string) {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) || 'null')
    if (
      value &&
      typeof value === 'object' &&
      'verifier' in value &&
      typeof value.verifier === 'string' &&
      /^[\w-]{43}$/.test(value.verifier) &&
      'redirectUrl' in value &&
      typeof value.redirectUrl === 'string' &&
      'createdAt' in value &&
      typeof value.createdAt === 'number' &&
      Date.now() >= value.createdAt &&
      Date.now() - value.createdAt < TRANSACTION_TTL
    )
      return { verifier: value.verifier, redirectUrl: value.redirectUrl }
  } catch {}
  removeWebAppLoginTransaction(key)
  return null
}

function base64Url(value: Uint8Array) {
  return btoa(String.fromCharCode(...value))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export async function createWebAppLoginProof() {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: base64Url(new Uint8Array(digest)) }
}
