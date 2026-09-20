import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { ThemeProvider } from 'next-themes'
import AppNotAccessible from './page'

const meta = {
  title: 'App/App Not Accessible',
  component: AppNotAccessible,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <ThemeProvider attribute="data-theme" defaultTheme="light">
        <Story />
      </ThemeProvider>
    ),
  ],
} satisfies Meta<typeof AppNotAccessible>

export default meta
type Story = StoryObj<typeof meta>

export const WithoutIP: Story = {}
export const IPv4: Story = { args: { clientIp: '203.0.113.42' } }
export const IPv6: Story = { args: { clientIp: '2001:db8:1234:5678:90ab:cdef:1234:5678' } }

export const NarrowIframe: Story = {
  render: () => (
    <iframe
      title="375px app error preview"
      width={375}
      height={667}
      src="/iframe.html?id=app-app-not-accessible--i-pv-6&viewMode=story"
    />
  ),
}
export const ShortIframe: Story = {
  render: () => (
    <iframe
      title="Short app error preview"
      width={800}
      height={360}
      src="/iframe.html?id=app-app-not-accessible--i-pv-4&viewMode=story"
    />
  ),
}
