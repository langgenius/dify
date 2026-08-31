import { render } from 'vitest-browser-react'
import OrgInfo from '../org-info'

function Footer({
  width,
  orgName,
  packageName,
}: {
  width: number
  orgName: string
  packageName: string
}) {
  return (
    <section aria-label="Plugin footer" className="flex items-center gap-2" style={{ width }}>
      <div className="flex min-w-0 grow items-center overflow-hidden">
        <OrgInfo
          orgName={orgName}
          packageName={packageName}
          packageNameClassName="w-auto max-w-[150px]"
        />
      </div>
      <div className="shrink-0">FROM MARKETPLACE</div>
    </section>
  )
}

describe('OrgInfo footer layout', () => {
  it('keeps names at their intrinsic width while space is available', async () => {
    // Chromium owns flex layout geometry and text overflow; happy-dom cannot prove this contract.
    const screen = await render(
      <Footer width={500} orgName="langgenius" packageName="lacuna_music" />,
    )
    const org = screen.getByText('langgenius').element()
    const packageName = screen.getByText('lacuna_music').element()
    const separator = screen.getByText('/').element().getBoundingClientRect()

    expect(org.scrollWidth).toBe(org.clientWidth)
    expect(packageName.scrollWidth).toBe(packageName.clientWidth)
    expect(separator.left - org.getBoundingClientRect().right).toBeCloseTo(2)
  })

  it('truncates both names before shrinking the source metadata', async () => {
    const screen = await render(
      <Footer
        width={260}
        orgName="a-very-long-plugin-organization"
        packageName="a-very-long-plugin-package-name"
      />,
    )
    const footer = screen.getByRole('region', { name: 'Plugin footer' }).element()
    const org = screen.getByText('a-very-long-plugin-organization').element()
    const packageName = screen.getByText('a-very-long-plugin-package-name').element()

    expect(org.scrollWidth).toBeGreaterThan(org.clientWidth)
    expect(packageName.scrollWidth).toBeGreaterThan(packageName.clientWidth)
    expect(footer.scrollWidth).toBe(footer.clientWidth)
  })
})
