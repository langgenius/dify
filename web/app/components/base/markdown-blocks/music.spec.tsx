import type { Mock } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import MarkdownMusic from './music'

let mockRenderAbc!: Mock<(...args: unknown[]) => unknown>
let mockSynthLoad!: Mock<(...args: unknown[]) => unknown>
let mockSynthSetTune!: Mock<(...args: unknown[]) => unknown>
let mockSynthInit!: Mock<(...args: unknown[]) => Promise<unknown>>

vi.mock('abcjs', () => {
  return {
    __esModule: true,
    default: {
      renderAbc: (...args: unknown[]) => mockRenderAbc(...args),
      synth: {
        SynthController: class {
          load(...args: unknown[]) {
            return mockSynthLoad(...args)
          }

          setTune(...args: unknown[]) {
            return mockSynthSetTune(...args)
          }
        },
        CreateSynth: class {
          init(...args: unknown[]) {
            return mockSynthInit(...args)
          }
        },
      },
    },
  }
})

describe('MarkdownMusic', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockRenderAbc = vi.fn(() => [{ id: 'visual' }])
    mockSynthLoad = vi.fn()
    mockSynthSetTune = vi.fn()
    mockSynthInit = vi.fn().mockResolvedValue(undefined)
  })

  it('renders abc notation string and initializes synth correctly', async () => {
    const abc = 'X:1\nT:Test\nK:C\nC D E F|'
    const { container } = render(<MarkdownMusic>{abc}</MarkdownMusic>)

    await waitFor(() => {
      expect(mockRenderAbc).toHaveBeenCalled()
    })

    expect(mockSynthLoad).toHaveBeenCalled()

    await waitFor(() => {
      expect(mockSynthInit).toHaveBeenCalled()
    })

    await waitFor(() => {
      expect(mockSynthSetTune).toHaveBeenCalledWith({ id: 'visual' }, false)
    })

    const innerDiv = container.querySelector('div > div') as HTMLElement
    expect(innerDiv.style.overflow).toBe('auto')
  })

  it('does not call abcjs when children is not a string', async () => {
    render(<MarkdownMusic><span>not a string</span></MarkdownMusic>)

    await waitFor(() => {
      expect(mockRenderAbc).not.toHaveBeenCalled()
      expect(mockSynthLoad).not.toHaveBeenCalled()
      expect(mockSynthInit).not.toHaveBeenCalled()
      expect(mockSynthSetTune).not.toHaveBeenCalled()
    })
  })
})
