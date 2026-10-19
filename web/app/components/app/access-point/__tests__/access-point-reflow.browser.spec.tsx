import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { AccessPointCard } from '@/app/components/base/access-point/card'
import { AccessPointUrl } from '@/app/components/base/access-point/url'
import { WebAppAccessControlEntry } from '../shared/web-app-access-control'

const parseColor = (color: string) => color.match(/[\d.]+/g)!.map(Number)

const luminance = (color: number[]) => {
  const channels = color.slice(0, 3).map((channel) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
}

const expectReadableContrast = (text: Element) => {
  const layers: number[][] = []
  for (let element: Element | null = text; element; element = element.parentElement)
    layers.push(parseColor(getComputedStyle(element).backgroundColor))

  // Input backgrounds are translucent; composite them over their actual ancestors.
  const background = layers.reverse().reduce(
    (background, layer) => {
      const alpha = layer[3] ?? 1
      return background.map((channel, index) => layer[index]! * alpha + channel * (1 - alpha))
    },
    [255, 255, 255],
  )
  const foregroundLuminance = luminance(parseColor(getComputedStyle(text).color))
  const backgroundLuminance = luminance(background)
  const contrast =
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  expect(contrast).toBeGreaterThanOrEqual(4.5)
}

it('keeps the heading, URL and actions reachable in the space available at 320px', async () => {
  await page.viewport(320, 900)
  const onRegenerate = vi.fn()
  // The collapsed console sidebar and page gutters leave 208px for a card.
  const screen = await render(
    <div style={{ width: 208 }}>
      <AccessPointCard
        title="Backend Service API"
        description="Integrate the app into your services over HTTP"
        icon="i-custom-vender-knowledge-api-aggregate"
        status="inService"
        statusLabel="In service"
        onEnabledChange={vi.fn()}
      >
        <AccessPointUrl
          enabled
          label="Access URL"
          value="https://example.test/workflow/1234567890"
          unavailableLabel="Unavailable"
          showOpen
          openLabel="Open"
          openUrl="https://example.test/workflow/1234567890"
          showQrCode
          showRegenerate
          regenerateLabel="Regenerate URL"
          onRegenerate={onRegenerate}
        />
        <WebAppAccessControlEntry
          accessConfigured={false}
          accessIcon="i-ri-lock-line"
          accessLabel="Specific members within the platform"
          disabled={false}
          onClick={vi.fn()}
        />
      </AccessPointCard>
    </div>,
  )
  const heading = screen.getByRole('heading', { name: 'Backend Service API' })
  const address = screen.getByText('https://example.test/workflow/1234567890')
  await expect.element(heading).toBeVisible()
  await expect.element(address).toBeVisible()

  expect(heading.element().clientWidth).toBeGreaterThan(0)
  expect(heading.element().scrollWidth).toBeLessThanOrEqual(heading.element().clientWidth)
  expect(address.element().getBoundingClientRect().width).toBeGreaterThan(0)
  const card = screen.getByRole('region', { name: 'Backend Service API' }).element()
  expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth)
  const accessEntry = screen.getByRole('button', { name: /Specific members within the platform/ })
  const accessLabel = screen.getByText('Specific members within the platform')
  await expect.element(accessEntry).toBeVisible()
  expect(accessLabel.element().getBoundingClientRect().right).toBeLessThanOrEqual(
    accessEntry.element().getBoundingClientRect().right,
  )

  const status = screen.getByText('In service').element()
  expectReadableContrast(status)

  await screen.getByRole('button', { name: 'Regenerate URL' }).click()
  expect(onRegenerate).toHaveBeenCalledOnce()
  await expect.element(screen.getByRole('link', { name: 'Open' })).toBeVisible()
})

it('keeps the unavailable endpoint readable while the open action is disabled', async () => {
  const screen = await render(
    <AccessPointUrl
      enabled={false}
      label="Access URL"
      value="https://example.test/workflow/1234567890"
      unavailable
      unavailableLabel="Unavailable"
      showOpen
      openLabel="Open"
    />,
  )
  const address = screen.getByText('https://example.test/workflow/1234567890')
  await expect.element(address).toBeVisible()
  expectReadableContrast(address.element())
  await expect.element(screen.getByRole('button', { name: 'Open' })).toBeDisabled()
})
