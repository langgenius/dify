import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { FakeXMLHttpRequest } from '@/test/fake-xhr'
import { uploadSkillFile } from '../client'

vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))
vi.mock('@/utils/client', () => ({ isClient: true, isServer: false }))

const waitForSend = () => vi.waitFor(() => expect(FakeXMLHttpRequest.latest().body).not.toBeNull())

describe('Skill file upload', () => {
  beforeEach(() => {
    FakeXMLHttpRequest.instances = []
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('reports upload progress and resolves the uploaded file', async () => {
    const onProgress = vi.fn()
    const pending = uploadSkillFile(new File(['content'], 'notes.md'), { onProgress })
    await waitForSend()
    const xhr = FakeXMLHttpRequest.latest()
    expect(new URL(xhr.url).pathname).toMatch(/\/workspaces\/current\/skills\/files\/upload$/)

    xhr.progress(5, 8)
    expect(onProgress).toHaveBeenCalledExactlyOnceWith(62)

    xhr.respond({ status: 201, body: { id: 'tool-file-1', size: 7 } })
    await expect(pending).resolves.toEqual({ id: 'tool-file-1', size: 7 })
  })

  it('preserves the network error and its cause on the progress transport', async () => {
    const pending = uploadSkillFile(new File(['content'], 'notes.md'), { onProgress: vi.fn() })
    await waitForSend()
    FakeXMLHttpRequest.latest().fail()

    await expect(pending).rejects.toMatchObject({
      name: 'NetworkError',
      cause: new TypeError('Failed to fetch'),
    })
  })

  it('cancels an active upload through the signal', async () => {
    const controller = new AbortController()
    const pending = uploadSkillFile(new File(['content'], 'notes.md'), {
      onProgress: vi.fn(),
      signal: controller.signal,
    })
    await waitForSend()

    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(FakeXMLHttpRequest.latest().aborted).toBe(true)
  })

  it('preserves the fetch transport network error and its cause', async () => {
    const error = new TypeError('Failed to fetch')
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(error)

    await expect(uploadSkillFile(new File(['content'], 'notes.md'))).rejects.toMatchObject({
      name: 'NetworkError',
      cause: error,
    })
  })
})
