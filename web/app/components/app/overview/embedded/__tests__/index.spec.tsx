import type { SiteInfo } from '@/models/share'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import copy from 'copy-to-clipboard'
import * as React from 'react'
import { act } from 'react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vite-plus/test'
import { InputVarType } from '@/app/components/workflow/types'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
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
vi.mock('copy-to-clipboard', () => ({
  default: vi.fn(),
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

const getCopyButton = () => screen.getByRole('button', { name: /copy/i })

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

  it('copies iframe snippet', async () => {
    const user = userEvent.setup()

    await act(async () => {
      render(<Embedded {...baseProps} />)
    })

    await waitFor(() => {
      expect(
        screen.getByText(
          (content, node) =>
            node?.tagName.toLowerCase() === 'pre' && content.includes('/chatbot/token'),
        ),
      ).toBeInTheDocument()
    })

    const copyButton = getCopyButton()
    await user.click(copyButton)

    await waitFor(() => {
      expect(mockedCopy).toHaveBeenCalledWith(expect.stringContaining('/chatbot/token'))
    })
  })

  it('links each embed method tab to a panel and supports arrow key selection', async () => {
    const user = userEvent.setup()
    await act(async () => {
      render(<Embedded {...baseProps} />)
    })

    const iframe = screen.getByRole('tab', {
      name: 'appOverview.overview.appInfo.embedded.iframe',
    })
    const scripts = screen.getByRole('tab', {
      name: 'appOverview.overview.appInfo.embedded.scripts',
    })
    const chromePlugin = screen.getByRole('tab', {
      name: 'appOverview.overview.appInfo.embedded.chromePlugin',
    })

    expect(screen.getByRole('tablist')).toBeInTheDocument()
    expect(iframe).toHaveAttribute('aria-selected', 'true')
    expect(scripts).toHaveAttribute('aria-selected', 'false')
    expect(chromePlugin).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', iframe.id)
    expect(iframe).toHaveAttribute('aria-controls', screen.getByRole('tabpanel').id)

    await user.click(iframe)
    expect(iframe).toHaveFocus()
    await user.keyboard('{ArrowRight}')

    expect(scripts).toHaveFocus()
    expect(iframe).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{Enter}')

    expect(iframe).toHaveAttribute('aria-selected', 'false')
    expect(scripts).toHaveAttribute('aria-selected', 'true')
    expect(chromePlugin).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', scripts.id)
  })

  it('opens chrome plugin store link when chrome option selected', async () => {
    const user = userEvent.setup()
    await act(async () => {
      render(<Embedded {...baseProps} />)
    })

    await user.click(
      screen.getByRole('tab', {
        name: 'appOverview.overview.appInfo.embedded.chromePlugin',
      }),
    )

    await user.click(
      within(screen.getByRole('tabpanel')).getByRole('button', {
        name: 'appOverview.overview.appInfo.embedded.chromePlugin',
      }),
    )

    expect(mockWindowOpen).toHaveBeenCalledWith(
      'https://chrome.google.com/webstore/detail/dify-chatbot/ceehdapohffmjmkdcifjofadiaoeggaf',
      '_blank',
      'noopener,noreferrer',
    )
  })

  it('calls onClose when the close button is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    await act(async () => {
      render(<Embedded {...baseProps} onClose={onClose} />)
    })

    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps hidden inputs collapsed by default and updates iframe and script content when values change', async () => {
    const user = userEvent.setup()
    render(
      <Embedded
        {...baseProps}
        hiddenInputs={[
          {
            variable: 'secret',
            label: 'Secret',
            type: InputVarType.textInput,
            hide: true,
            required: true,
            default: '',
          },
        ]}
      />,
    )

    expect(screen.queryByLabelText('Secret')).not.toBeInTheDocument()

    await act(async () => {
      fireEvent.click(
        screen
          .getByText('appOverview.overview.appInfo.embedded.hiddenInputs.title')
          .closest('button')!,
      )
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

    await user.click(
      screen.getByRole('tab', {
        name: 'appOverview.overview.appInfo.embedded.scripts',
      }),
    )

    await waitFor(() => {
      const codeBlock = document.querySelector('pre')
      expect(codeBlock?.textContent ?? '').toContain('secret: "top-secret"')
    })
  })

  it('copies script content when scripts option is selected', async () => {
    const user = userEvent.setup()

    await act(async () => {
      render(<Embedded {...baseProps} />)
    })

    await user.click(
      screen.getByRole('tab', {
        name: 'appOverview.overview.appInfo.embedded.scripts',
      }),
    )

    await waitFor(() => {
      const codeBlock = document.querySelector('pre')
      expect(codeBlock?.textContent ?? '').toContain("token: 'token'")
      expect(codeBlock?.textContent ?? '').toContain('background-color: #000000')
    })

    const copyButton = getCopyButton()
    await user.click(copyButton)

    await waitFor(() => {
      expect(mockedCopy).toHaveBeenCalledWith(expect.stringContaining("token: 'token'"))
    })
  })

  it('copies chrome plugin URL (without prefix) when chromePlugin option is selected', async () => {
    const user = userEvent.setup()

    await act(async () => {
      render(<Embedded {...baseProps} />)
    })

    await user.click(
      screen.getByRole('tab', {
        name: 'appOverview.overview.appInfo.embedded.chromePlugin',
      }),
    )

    await waitFor(() => {
      const codeBlock = document.querySelector('pre')
      expect(codeBlock?.textContent ?? '').toContain('ChatBot URL:')
    })

    const copyButton = getCopyButton()
    await user.click(copyButton)

    await waitFor(() => {
      expect(mockedCopy).toHaveBeenCalledWith(expect.stringContaining('/chatbot/token'))
      expect(mockedCopy).not.toHaveBeenCalledWith(expect.stringContaining('ChatBot URL:'))
    })
  })
})
