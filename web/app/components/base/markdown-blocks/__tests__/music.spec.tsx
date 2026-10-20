import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createDeferred } from '@/test/deferred'
import MarkdownMusic from '../music'

const mockSetTune = vi.fn()
const mockLoad = vi.fn()
const mockInit = vi.fn().mockResolvedValue(undefined)
const mockRenderAbc = vi.fn().mockReturnValue([{}])

vi.mock('abcjs', () => ({
  __esModule: true,
  default: {
    renderAbc: (...args: unknown[]) => mockRenderAbc(...args),
    synth: {
      SynthController: class {
        load(...args: unknown[]) {
          mockLoad(...args)
        }

        setTune(...args: unknown[]) {
          mockSetTune(...args)
        }
      },
      CreateSynth: class {
        init(...args: unknown[]) {
          return mockInit(...args)
        }
      },
    },
  },
}))

describe('MarkdownMusic', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockInit.mockResolvedValue(undefined)
    mockRenderAbc.mockReturnValue([{}])
  })

  describe('String Input', () => {
    it('should not render fallback when children is not a string', async () => {
      render(
        <MarkdownMusic>
          <span>not a string</span>
        </MarkdownMusic>,
      )
      expect(mockRenderAbc).not.toHaveBeenCalled()
      expect(mockLoad).not.toHaveBeenCalled()
      expect(mockInit).not.toHaveBeenCalled()
    })

    it('renders notation and makes its tune playable only after synthesis is ready', async () => {
      const visualObj = { tune: 'test-notation' }
      const pending = createDeferred<void>()
      mockRenderAbc.mockReturnValue([visualObj])
      mockInit.mockReturnValue(pending.promise)
      render(<MarkdownMusic>{'X:1\nT:Opts\nK:C\nC D E F|'}</MarkdownMusic>)

      expect(mockRenderAbc).toHaveBeenCalledWith(
        expect.any(HTMLDivElement),
        'X:1\nT:Opts\nK:C\nC D E F|',
        expect.objectContaining({
          add_classes: true,
          responsive: 'resize',
        }),
      )
      expect(mockLoad).toHaveBeenCalledWith(expect.any(HTMLDivElement), {}, { displayPlay: true })
      expect(mockInit).toHaveBeenCalledExactlyOnceWith({ visualObj })
      expect(mockSetTune).not.toHaveBeenCalled()
      await act(async () => pending.resolve())
      await waitFor(() => expect(mockSetTune).toHaveBeenCalledExactlyOnceWith(visualObj, false))
    })
  })
})
