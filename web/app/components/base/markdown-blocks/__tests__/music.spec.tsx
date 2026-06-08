import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

const loadMarkdownMusic = async () => (await import('../music')).default

describe('MarkdownMusic', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  // Base rendering behavior for the component shell.
  describe('Rendering', () => {
    it('should render wrapper and two internal container nodes', async () => {
      const MarkdownMusic = await loadMarkdownMusic()
      const { container } = render(<MarkdownMusic><span>child</span></MarkdownMusic>)

      const topLevel = container.firstElementChild as HTMLElement | null
      expect(topLevel).toBeTruthy()
      expect(topLevel?.children.length).toBe(2)
      expect(topLevel?.style.minWidth).toBe('100%')
      expect(topLevel?.style.overflow).toBe('auto')
    })
  })

  // String input should trigger abcjs rendering and synth initialization.
  describe('String Input', () => {
    it('should render music notation and initialize synth when children is a string', async () => {
      const MarkdownMusic = await loadMarkdownMusic()
      render(<MarkdownMusic>{'X:1\nT:Test\nK:C\nC D E F|'}</MarkdownMusic>)

      expect(mockRenderAbc).toHaveBeenCalledTimes(1)
      expect(mockLoad).toHaveBeenCalledTimes(1)
      expect(mockInit).toHaveBeenCalledTimes(1)
      await Promise.resolve()
      expect(mockSetTune).toHaveBeenCalledTimes(1)
    })

    it('should not render fallback when children is not a string', async () => {
      const MarkdownMusic = await loadMarkdownMusic()
      render(<MarkdownMusic><span>not a string</span></MarkdownMusic>)
      expect(mockRenderAbc).not.toHaveBeenCalled()
      expect(mockLoad).not.toHaveBeenCalled()
      expect(mockInit).not.toHaveBeenCalled()
    })

    it('should call abcjs renderer with expected options for string input', async () => {
      const MarkdownMusic = await loadMarkdownMusic()
      render(<MarkdownMusic>{'X:1\nT:Opts\nK:C\nC D E F|'}</MarkdownMusic>)

      expect(mockRenderAbc).toHaveBeenCalledWith(
        expect.any(HTMLDivElement),
        'X:1\nT:Opts\nK:C\nC D E F|',
        expect.objectContaining({
          add_classes: true,
          responsive: 'resize',
        }),
      )
    })

    it('should skip initialization when refs are unavailable', async () => {
      vi.doMock('react', async (importOriginal) => {
        const actual = await importOriginal<typeof import('react')>()
        return {
          ...actual,
          useEffect: (effect: () => void) => {
            effect()
          },
        }
      })
      const MarkdownMusic = await loadMarkdownMusic()
      render(<MarkdownMusic>{'X:1\nT:NoRef\nK:C\nC D E F|'}</MarkdownMusic>)

      expect(mockRenderAbc).not.toHaveBeenCalled()
      expect(mockLoad).not.toHaveBeenCalled()
      expect(mockInit).not.toHaveBeenCalled()

      vi.doUnmock('react')
    })
  })
})
