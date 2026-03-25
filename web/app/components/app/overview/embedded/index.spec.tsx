import type { SiteInfo } from '@/models/share'
import { fireEvent, render, screen } from '@testing-library/react'
import copy from 'copy-to-clipboard'
import * as React from 'react'

import { act } from 'react'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import Embedded from './index'

vi.mock('./style.module.css', () => ({
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
  afterEach(() => {
    vi.clearAllMocks()
    mockWindowOpen.mockClear()
  })

  afterAll(() => {
    mockWindowOpen.mockRestore()
  })

  it('builds theme and copies iframe snippet', async () => {
    await act(async () => {
      render(<Embedded {...baseProps} />)
    })

    const actionButton = getCopyButton()
    const innerDiv = actionButton.querySelector('div')
    act(() => {
      fireEvent.click(innerDiv ?? actionButton)
    })

    expect(mockThemeBuilder.buildTheme).toHaveBeenCalledWith(siteInfo.chat_color_theme, siteInfo.chat_color_theme_inverted)
    expect(mockedCopy).toHaveBeenCalledWith(expect.stringContaining('/chatbot/token'))
  })

  it('opens chrome plugin store link when chrome option selected', async () => {
    await act(async () => {
      render(<Embedded {...baseProps} />)
    })

    const optionButtons = document.body.querySelectorAll('[class*="option"]')
    expect(optionButtons.length).toBeGreaterThanOrEqual(3)
    act(() => {
      fireEvent.click(optionButtons[2])
    })

    const [chromeText] = screen.getAllByText('appOverview.overview.appInfo.embedded.chromePlugin')
    act(() => {
      fireEvent.click(chromeText)
    })

    expect(mockWindowOpen).toHaveBeenCalledWith(
      'https://chrome.google.com/webstore/detail/dify-chatbot/ceehdapohffmjmkdcifjofadiaoeggaf',
      '_blank',
      'noopener,noreferrer',
    )
  })
})
