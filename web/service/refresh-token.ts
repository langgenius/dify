import { API_PREFIX } from '@/config'
import { isClient } from '@/utils/client'

const STORAGE_KEY = `console-session-refresh:${API_PREFIX}`
const POLL_INTERVAL = 1000

type RefreshAttempt = {
  id: string
  expiresAt: number
} & ({ state: 'pending' | 'succeeded' } | { state: 'failed'; message: string })

let inFlight: Promise<void> | undefined
let storageAvailable = true

function parseAttempt(serialized: string | null): RefreshAttempt | undefined {
  try {
    const value: unknown = JSON.parse(serialized || 'null')
    if (
      typeof value !== 'object' ||
      value === null ||
      !('id' in value) ||
      typeof value.id !== 'string' ||
      !('expiresAt' in value) ||
      typeof value.expiresAt !== 'number' ||
      !Number.isFinite(value.expiresAt) ||
      !('state' in value)
    )
      return
    if (
      value.state === 'pending' ||
      value.state === 'succeeded' ||
      (value.state === 'failed' && 'message' in value && typeof value.message === 'string')
    )
      return value as RefreshAttempt
  } catch {}
}

function readAttempt(): RefreshAttempt | undefined {
  if (!storageAvailable) return
  try {
    return parseAttempt(globalThis.localStorage.getItem(STORAGE_KEY))
  } catch {
    storageAvailable = false
  }
}

function writeAttempt(attempt: RefreshAttempt) {
  if (!storageAvailable) return
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(attempt))
  } catch {
    storageAvailable = false
  }
}

function waitForResult<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

function completeAttempt(attempt: RefreshAttempt) {
  if (attempt.state === 'failed') throw new Error(attempt.message)
}

function waitForOtherDocument(attemptId: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    function cleanup() {
      clearTimeout(timer)
      globalThis.removeEventListener('storage', onStorage)
      signal.removeEventListener('abort', onAbort)
    }
    function onAbort() {
      cleanup()
      reject(signal.reason)
    }
    function acceptResult(attempt: RefreshAttempt | undefined) {
      if (!attempt || attempt.id !== attemptId || attempt.state === 'pending') return false
      cleanup()
      if (attempt.state === 'failed') reject(new Error(attempt.message))
      else resolve()
      return true
    }
    function onStorage(event: StorageEvent) {
      if (event.key !== STORAGE_KEY) return
      if (signal.aborted) {
        onAbort()
        return
      }
      // Queued events preserve this attempt's outcome after another refresh replaces the record.
      acceptResult(parseAttempt(event.newValue))
    }
    function check() {
      clearTimeout(timer)
      if (signal.aborted) {
        onAbort()
        return
      }
      const attempt = readAttempt()
      if (!storageAvailable) {
        cleanup()
        resolve(refreshSession(signal))
        return
      }
      if (acceptResult(attempt)) return
      if (attempt?.id === attemptId) {
        if (attempt.expiresAt <= Date.now()) {
          cleanup()
          reject(new Error('Session refresh expired before its result was available'))
          return
        }
        timer = setTimeout(check, Math.min(POLL_INTERVAL, attempt.expiresAt - Date.now()))
      } else {
        timer = setTimeout(check, POLL_INTERVAL)
      }
    }
    globalThis.addEventListener('storage', onStorage)
    signal.addEventListener('abort', onAbort, { once: true })
    check()
  })
}

async function refreshSession(signal: AbortSignal) {
  signal.throwIfAborted()
  const response = await globalThis.fetch(`${API_PREFIX}/refresh-token`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json;utf-8' },
    signal,
  })
  signal.throwIfAborted()
  if (!response.ok) throw response
}

async function runAttempt(timeout: number, signal: AbortSignal) {
  signal.throwIfAborted()
  const attempt: RefreshAttempt = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    state: 'pending',
    expiresAt: Date.now() + timeout,
  }
  writeAttempt(attempt)
  const owner = readAttempt()
  if (storageAvailable && owner && owner.id !== attempt.id)
    return waitForOtherDocument(owner.id, signal)

  const publish = (result: RefreshAttempt) => {
    // A timed-out owner must never overwrite a newer document's attempt.
    if (readAttempt()?.id === attempt.id) writeAttempt(result)
  }
  try {
    await refreshSession(signal)
    publish({ ...attempt, state: 'succeeded', expiresAt: Date.now() + timeout })
  } catch (error) {
    publish({
      ...attempt,
      state: 'failed',
      expiresAt: Date.now() + timeout,
      message:
        error instanceof Response
          ? `Session refresh failed (${error.status})`
          : error instanceof Error
            ? error.message
            : 'Session refresh failed',
    })
    throw error
  }
}

async function coordinateRefresh(timeout: number, signal: AbortSignal) {
  const observed = readAttempt()
  const acceptCompletedAttempt = (current: RefreshAttempt | undefined) => {
    if (
      current &&
      current.expiresAt > Date.now() &&
      current.state !== 'pending' &&
      (current.id !== observed?.id || observed.state === 'pending')
    ) {
      completeAttempt(current)
      return true
    }
    return false
  }
  const withoutLock = () => {
    const current = readAttempt()
    if (observed?.state === 'pending' && observed.expiresAt > Date.now())
      return waitForOtherDocument(observed.id, signal)
    if (acceptCompletedAttempt(current)) return
    if (current?.state === 'pending' && current.expiresAt > Date.now())
      return waitForOtherDocument(current.id, signal)
    return runAttempt(timeout, signal)
  }
  let locks: LockManager | undefined
  try {
    locks = globalThis.navigator?.locks
  } catch {
    return withoutLock()
  }
  if (!locks) return withoutLock()

  let acquired = false
  try {
    await locks.request(STORAGE_KEY, { signal }, async () => {
      acquired = true
      signal.throwIfAborted()
      if (acceptCompletedAttempt(readAttempt())) return
      await runAttempt(timeout, signal)
    })
  } catch (error) {
    if (!acquired && error instanceof DOMException && error.name === 'SecurityError')
      return withoutLock()
    throw error
  }
}

export function refreshAccessTokenOrReLogin(timeout: number, signal?: AbortSignal): Promise<void> {
  if (!isClient) return Promise.reject(new Error('refresh token is client-only'))
  if (signal?.aborted) return Promise.reject(signal.reason)

  if (!inFlight) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('request timeout')), timeout)
    const operation = waitForResult(
      coordinateRefresh(timeout, controller.signal),
      controller.signal,
    ).finally(() => {
      clearTimeout(timer)
      if (inFlight === operation) inFlight = undefined
    })
    inFlight = operation
  }
  return waitForResult(inFlight, signal)
}
