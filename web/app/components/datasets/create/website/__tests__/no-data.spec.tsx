import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vite-plus/test'
import { DataSourceProvider } from '@/models/common'
import NoData from '../no-data'

// Mock Setup

// Feature flags - default all enabled
let mockEnableFirecrawl = true
let mockEnableJinaReader = true
let mockEnableWaterCrawl = true

vi.mock('@/config', () => ({
  get ENABLE_WEBSITE_FIRECRAWL() {
    return mockEnableFirecrawl
  },
  get ENABLE_WEBSITE_JINAREADER() {
    return mockEnableJinaReader
  },
  get ENABLE_WEBSITE_WATERCRAWL() {
    return mockEnableWaterCrawl
  },
}))

beforeEach(() => {
  mockEnableFirecrawl = true
  mockEnableJinaReader = true
  mockEnableWaterCrawl = true
})

it.each([
  [DataSourceProvider.fireCrawl, 'fireCrawl'],
  [DataSourceProvider.jinaReader, 'jinaReader'],
  [DataSourceProvider.waterCrawl, 'waterCrawl'],
])('offers setup for the selected provider %s', async (provider, name) => {
  const user = userEvent.setup()
  const onConfig = vi.fn()
  render(<NoData onConfig={onConfig} provider={provider} />)
  expect(
    screen.getByText(`datasetCreation.stepOne.website.${name}NotConfigured`),
  ).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /configure/ }))
  expect(onConfig).toHaveBeenCalledOnce()
})

it.each([DataSourceProvider.fireCrawl, DataSourceProvider.waterCrawl])(
  'offers the Jina fallback when %s is disabled',
  async (provider) => {
    const user = userEvent.setup()
    mockEnableFirecrawl = false
    mockEnableWaterCrawl = false
    const onConfig = vi.fn()
    render(<NoData onConfig={onConfig} provider={provider} />)
    expect(
      screen.getByText('datasetCreation.stepOne.website.jinaReaderNotConfigured'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /configure/ }))
    expect(onConfig).toHaveBeenCalledOnce()
  },
)

it('does not offer setup when neither the selected provider nor the fallback is enabled', () => {
  mockEnableFirecrawl = false
  mockEnableJinaReader = false
  render(<NoData onConfig={vi.fn()} provider={DataSourceProvider.fireCrawl} />)
  expect(screen.queryByRole('button', { name: /configure/ })).not.toBeInTheDocument()
})
