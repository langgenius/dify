import { useState } from 'react'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { SourceProviderIcon } from '../fields'

const validIcon =
  'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22%3E%3Crect width=%2216%22 height=%2216%22 fill=%22%234B7BEC%22/%3E%3C/svg%3E'
const brokenIcon = 'data:image/png;base64,broken-image'

function IconSession() {
  const [icon, setIcon] = useState(brokenIcon)
  return (
    <>
      <SourceProviderIcon icon={icon} fallbackIcon="i-ri-file-text-line" />
      <button type="button" onClick={() => setIcon(validIcon)}>
        Use valid icon
      </button>
      <button type="button" onClick={() => setIcon(brokenIcon)}>
        Use broken icon
      </button>
    </>
  )
}

describe('SourceProviderIcon', () => {
  beforeEach(async () => {
    await page.viewport(480, 320)
    onTestFinished(guardUnexpectedFetch())
  })

  it('recovers from a native decode failure for each new image session', async () => {
    const { queryClient, wrapper: Wrapper } = createConsoleQueryWrapper({
      currentWorkspace: { id: 'workspace-123' },
    })
    onTestFinished(() => queryClient.clear())
    const screen = await render(
      <Wrapper>
        <IconSession />
      </Wrapper>,
    )
    const image = () => screen.getByAltText('')

    await expect.element(image()).not.toBeInTheDocument()

    await screen.getByRole('button', { name: 'Use valid icon' }).click()
    await expect.element(image()).toHaveAttribute('src', validIcon)
    await expect
      .poll(() => {
        const element = image().element() as HTMLImageElement
        return element.complete && element.naturalWidth
      })
      .toBeGreaterThan(0)

    await screen.getByRole('button', { name: 'Use broken icon' }).click()
    await expect.element(image()).not.toBeInTheDocument()

    await screen.getByRole('button', { name: 'Use valid icon' }).click()
    await expect
      .poll(() => {
        const element = image().element() as HTMLImageElement
        return element.complete && element.naturalWidth
      })
      .toBeGreaterThan(0)
  })
})
