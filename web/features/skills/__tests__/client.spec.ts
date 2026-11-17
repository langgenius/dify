import { describe, expect, it, vi } from 'vite-plus/test'
import { uploadSkillFile } from '../client'

vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))

describe('Skill upload transport failures', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    ['error', 'TypeError'],
    ['abort', 'AbortError'],
    ['timeout', 'TimeoutError'],
  ])('preserves the %s error type through the upload client', async (event, name) => {
    const xhr = new XMLHttpRequest()
    vi.spyOn(xhr, 'open').mockImplementation(() => {})
    vi.spyOn(xhr, 'setRequestHeader').mockImplementation(() => {})
    vi.spyOn(xhr, 'send').mockImplementation(() => xhr.dispatchEvent(new Event(event)))

    await expect(
      uploadSkillFile(new File(['content'], 'notes.md'), { xhr, onProgress: vi.fn() }),
    ).rejects.toMatchObject({ name })
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
