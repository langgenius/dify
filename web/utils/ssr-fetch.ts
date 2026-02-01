import { cookies } from 'next/headers'
import { cache } from 'react'

const SSR_API_PREFIX = process.env.NEXT_PUBLIC_API_PREFIX || 'http://localhost:5001/console/api'

export const getAuthHeaders = cache(async () => {
  const cookieStore = await cookies()
  const cookieHeader = cookieStore.getAll().map(c => `${c.name}=${c.value}`).join('; ')
  const csrfToken = cookieStore.get('csrf_token')?.value
    || cookieStore.get('__Host-csrf_token')?.value
  return {
    'Content-Type': 'application/json',
    'Cookie': cookieHeader,
    ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
  }
})

type ServerFetchResult<T> = {
  data: T
  headers: Headers
}

export async function serverFetchWithAuth<T>(
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<ServerFetchResult<T>> {
  const headers = await getAuthHeaders()
  const res = await fetch(`${SSR_API_PREFIX}${path}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: 'no-store',
  })

  if (!res.ok)
    throw new Error(`${res.status}`)

  const data: T = await res.json()
  return { data, headers: res.headers }
}

export async function serverFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${SSR_API_PREFIX}${path}`, { cache: 'no-store' })
  if (!res.ok)
    throw new Error(`${res.status}`)
  return res.json()
}
