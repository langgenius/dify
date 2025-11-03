import type { Meta, StoryObj } from '@storybook/nextjs'
import { ThemeProvider } from 'next-themes'
import type { ReactNode } from 'react'
import DifyLogo from './dify-logo'
import LogoSite from './logo-site'
import LogoEmbeddedChatHeader from './logo-embedded-chat-header'
import LogoEmbeddedChatAvatar from './logo-embedded-chat-avatar'

const meta = {
  title: 'Base/General/Logo',
  component: DifyLogo,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Brand assets rendered in different contexts. DifyLogo adapts to the active theme while other variants target specific surfaces.',
      },
    },
  },
  args: {
    size: 'medium',
    style: 'default',
  },
  argTypes: {
    size: {
      control: 'radio',
      options: ['large', 'medium', 'small'],
    },
    style: {
      control: 'radio',
      options: ['default', 'monochromeWhite'],
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof DifyLogo>

export default meta
type Story = StoryObj<typeof meta>

const ThemePreview = ({ theme, children }: { theme: 'light' | 'dark'; children: ReactNode }) => {
  return (
    <ThemeProvider attribute="data-theme" forcedTheme={theme} enableSystem={false}>
      <div
        className={'min-w-[320px] rounded-2xl border border-divider-subtle bg-background-default-subtle p-6 shadow-sm'}
      >
        {children}
      </div>
    </ThemeProvider>
  )
}

export const Playground: Story = {
  render: ({ size, style }) => {
    return (
      <ThemePreview theme="dark">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <span className="text-xs uppercase tracking-[0.18em] text-text-tertiary">Primary logo</span>
            <div className="flex items-center justify-between rounded-xl border border-divider-subtle bg-background-default p-4">
              <DifyLogo size={size} style={style} />
              <code className="text-[11px] text-text-tertiary">{`size="${size}" | style="${style}"`}</code>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2 rounded-xl border border-divider-subtle bg-background-default p-4">
              <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-text-tertiary">Site favicon</span>
              <LogoSite />
            </div>
            <div className="flex flex-col gap-2 rounded-xl border border-divider-subtle bg-background-default p-4">
              <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-text-tertiary">Embedded header</span>
              <LogoEmbeddedChatHeader />
            </div>
            <div className="flex flex-col gap-2 rounded-xl border border-divider-subtle bg-background-default p-4 sm:col-span-2">
              <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-text-tertiary">Embedded avatar</span>
              <LogoEmbeddedChatAvatar className="border-divider-strong rounded-2xl border" />
            </div>
          </div>
        </div>
      </ThemePreview>
    )
  },
}
