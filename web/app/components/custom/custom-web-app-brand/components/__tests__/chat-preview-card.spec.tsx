import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ChatPreviewCard from '../chat-preview-card'

describe('ChatPreviewCard', () => {
  it('should render the chat preview with the powered-by footer', () => {
    render(
      <ChatPreviewCard
        imgKey={8}
        webappLogo="https://example.com/custom-logo.png"
      />,
    )

    expect(screen.getByText('Chatflow App')).toBeInTheDocument()
    expect(screen.getByText('Hello! How can I assist you today?')).toBeInTheDocument()
    expect(screen.getByText('Talk to Dify')).toBeInTheDocument()
    expect(screen.getByText('POWERED BY')).toBeInTheDocument()
  })

  it('should hide chat branding footer when brand removal is enabled', () => {
    render(
      <ChatPreviewCard
        imgKey={8}
        webappBrandRemoved
        webappLogo="https://example.com/custom-logo.png"
      />,
    )

    expect(screen.queryByText('POWERED BY')).not.toBeInTheDocument()
  })
})
