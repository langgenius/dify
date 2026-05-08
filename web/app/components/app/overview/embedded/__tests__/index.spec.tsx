import type { SiteInfo } from '@/models/share'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import copy from 'copy-to-clipboard'
import * as React from 'react'
import { act } from 'react'

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { InputVarType } from '@/app/components/workflow/types'
import Embedded from '../index'

vi.mock('../style.module.css', () => ({
  default: {
    option: 'option',
    active: 'active',
    iframeIcon: 'iframeIcon',
    scriptsIcon: 'scriptsIcon',
    chromePluginIcon: 'chromePluginIcon',
    pluginInstallIcon: 'pluginInstallIcon',
  },
}))
const mockThemeBuilder = {
  buildTheme: vi.fn(),
  theme: {
    primaryColor: '#123456',
  },
}
const mockUseAppContext = vi.fn(() => ({
  langGeniusVersionInfo: {
    current_env: 'PRODUCTION',
    current_version: '',
    latest_version: '',
    release_date: '',
    release_notes: '',
    version: '',
    can_auto_update: false,
  },
}))

vi.mock('copy-to-clipboard', () => ({
  default: vi.fn(),
}))
vi.mock('@/app/components/base/chat/embedded-chatbot/theme/theme-context', () => ({
  useThemeContext: () => mockThemeBuilder,
}))
vi.mock('@/context/app-context', () => ({
  useAppContext: () => mockUseAppContext(),
}))
const mockWindowOpen = vi.spyOn(window, 'open').mockImplementation(() => null)
const mockedCopy = vi.mocked(copy)
const originalCompressionStream = globalThis.CompressionStream

const siteInfo: SiteInfo = {
  title: 'test site',
  chat_color_theme: '#000000',
  chat_color_theme_inverted: false,
}

const baseProps = {
  isShow: true,
  siteInfo,
  onClose: vi.fn(),
  appBaseUrl: 'https://app.example.com',
  accessToken: 'token',
  className: 'custom-modal',
}

const getCopyButton = () => {
  const buttons = screen.getAllByRole('button')
  const actionButton = buttons.find(button => button.className.includes('action-btn'))
  expect(actionButton).toBeDefined()
  return actionButton!
}

describe('Embedded', () => {
  beforeAll(() => {
    class MockCompressionStream {
      readable: ReadableStream<Uint8Array>
      writable: WritableStream<Uint8Array>

      constructor() {
        const transformStream = new TransformStream<Uint8Array, Uint8Array>()
        this.readable = transformStream.readable
        this.writable = transformStream.writable
      }
    }

    // @ts-expect-error test polyfill
    globalThis.CompressionStream = MockCompressionStream
  })

  afterEach(() => {
    vi.clearAllMocks()
    mockWindowOpen.mockClear()
  })

  afterAll(() => {
    mockWindowOpen.mockRestore()
    globalThis.CompressionStream = originalCompressionStream
  })

  it('builds theme and copies iframe snippet', async () => {
    await act(async () => {
      render(<Embedded {...baseProps} />)
    })

    await waitFor(() => {
      expect(screen.getByText((content, node) => node?.tagName.toLowerCase() === 'pre' && content.includes('/chatbot/token'))).toBeInTheDocument()
    })

    const actionButton = getCopyButton()
    const innerDiv = actionButton.querySelector('div')
    await act(async () => {
      fireEvent.click(innerDiv ?? actionButton)
    })

    expect(mockThemeBuilder.buildTheme).toHaveBeenCalledWith(siteInfo.chat_color_theme, siteInfo.chat_color_theme_inverted)
    await waitFor(() => {
      expect(mockedCopy).toHaveBeenCalledWith(expect.stringContaining('/chatbot/token'))
    })
  })

  it('opens chrome plugin store link when chrome option selected', async () => {
    await act(async () => {
      render(<Embedded {...baseProps} />)
    })

    const optionButtons = document.body.querySelectorAll('[class*="option"]')
    expect(optionButtons.length).toBeGreaterThanOrEqual(3)
    act(() => {
      fireEvent.click(optionButtons[2]!)
    })

    const [chromeText] = screen.getAllByText('appOverview.overview.appInfo.embedded.chromePlugin')
    act(() => {
      fireEvent.click(chromeText!)
    })

    expect(mockWindowOpen).toHaveBeenCalledWith(
      'https://chrome.google.com/webstore/detail/dify-chatbot/ceehdapohffmjmkdcifjofadiaoeggaf',
      '_blank',
      'noopener,noreferrer',
    )
  })

  it('keeps hidden inputs collapsed by default and updates iframe and script content when values change', async () => {
    render(
      <Embedded
        {...baseProps}
        hiddenInputs={[{
          variable: 'secret',
          label: 'Secret',
          type: InputVarType.textInput,
          hide: true,
          required: true,
          default: '',
        }]}
      />,
    )

    expect(screen.queryByLabelText('Secret')).not.toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByText('appOverview.overview.appInfo.embedded.hiddenInputs.title').closest('button')!)
    })

    await waitFor(() => {
      expect(screen.getByLabelText('Secret')).toBeInTheDocument()
    })

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Secret'), {
        target: { value: 'top-secret' },
      })
    })

    expect(document.querySelector('pre')?.textContent ?? '').toContain('/chatbot/token')

    await waitFor(() => {
      const codeBlock = document.querySelector('pre')
      expect(codeBlock?.textContent ?? '').toContain('/chatbot/token?secret=dG9wLXNlY3JldA%3D%3D')
    })

    const optionButtons = document.body.querySelectorAll('[class*="option"]')
    act(() => {
      fireEvent.click(optionButtons[1]!)
    })

    await waitFor(() => {
      const codeBlock = document.querySelector('pre')
      expect(codeBlock?.textContent ?? '').toContain('secret: "top-secret"')
    })
  })

  it('copies script content when scripts option is selected', async () => {
    await act(async () => {
      render(<Embedded {...baseProps} />)
    })

    const optionButtons = document.body.querySelectorAll('[class*="option"]')
    act(() => {
      fireEvent.click(optionButtons[1]!)
    })

    await waitFor(() => {
      const codeBlock = document.querySelector('pre')
      expect(codeBlock?.textContent ?? '').toContain('token: \'token\'')
    })

    const actionButton = getCopyButton()
    const innerDiv = actionButton.querySelector('div')
    await act(async () => {
      fireEvent.click(innerDiv ?? actionButton)
    })

    await waitFor(() => {
      expect(mockedCopy).toHaveBeenCalledWith(expect.stringContaining('token: \'token\''))
    })
  })

  it('copies chrome plugin URL (without prefix) when chromePlugin option is selected', async () => {
    await act(async () => {
      render(<Embedded {...baseProps} />)
    })

    const optionButtons = document.body.querySelectorAll('[class*="option"]')
    act(() => {
      fireEvent.click(optionButtons[2]!)
    })

    await waitFor(() => {
      const codeBlock = document.querySelector('pre')
      expect(codeBlock?.textContent ?? '').toContain('ChatBot URL:')
    })

    const actionButton = getCopyButton()
    const innerDiv = actionButton.querySelector('div')
    await act(async () => {
      fireEvent.click(innerDiv ?? actionButton)
    })

    await waitFor(() => {
      expect(mockedCopy).toHaveBeenCalledWith(expect.stringContaining('/chatbot/token'))
      expect(mockedCopy).not.toHaveBeenCalledWith(expect.stringContaining('ChatBot URL:'))
    })
  })
})
