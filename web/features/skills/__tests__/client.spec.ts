import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { FakeXMLHttpRequest } from '@/test/fake-xhr'
import { fetchSkillArchiveBlob, fetchSkillFileBlob, uploadSkillFile } from '../client'

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

describe('Skill file downloads', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns file content as a Blob even when the file is JSON', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"name":"config"}', {
        headers: {
          'content-type': 'application/json',
          'content-disposition': 'inline; filename=config.json',
        },
      }),
    )

    const blob = await fetchSkillFileBlob({
      download: true,
      path: 'config.json',
      skillId: 'skill-1',
      versionId: 'version-1',
    })

    expect(blob).toBeInstanceOf(Blob)
    expect(await blob.text()).toBe('{"name":"config"}')
    const request = fetchSpy.mock.calls[0]![0] as Request
    const url = new URL(request.url)
    expect(url.pathname).toMatch(/\/workspaces\/current\/skills\/skill-1\/files\/content$/)
    expect(Object.fromEntries(url.searchParams)).toEqual({
      path: 'config.json',
      version_id: 'version-1',
      download: '1',
    })
  })

  it('returns the exported archive as a Blob', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Blob(['zip']), {
        headers: {
          'content-type': 'application/zip',
          'content-disposition': 'attachment; filename=skill.zip',
        },
      }),
    )

    const blob = await fetchSkillArchiveBlob('skill-1')

    expect(blob).toBeInstanceOf(Blob)
    expect(await blob.text()).toBe('zip')
  })
})
