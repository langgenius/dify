import { render } from 'vitest-browser-react'
import { useLocale } from '#i18n'
import { Markdown } from '../index'
import '@/app/styles/markdown.css'

vi.mock('#i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#i18n')>()),
  useLocale: vi.fn(() => 'en-US'),
}))

// Real Markdown and CSS expose misplaced list indentation and quote borders
// that a DOM-only direction-attribute assertion cannot detect.
it.each(['fa-IR', 'ar-TN'] as const)(
  'keeps %s prose, lists and quotes readable while code remains left-to-right',
  async (locale) => {
    vi.mocked(useLocale).mockReturnValue(locale)
    const screen = await render(
      <Markdown
        content={'سلام\n\n- اولین مورد\n\n> نقل قول\n\n```text\nhello(world)\n```'}
        mode="static"
      />,
    )
    await expect.element(screen.getByText('سلام', { exact: true })).toHaveStyle({ direction: 'rtl' })
    const list = screen.getByRole('list')
    await expect
      .element(list)
      .toHaveStyle({ direction: 'rtl', paddingLeft: '0px', paddingRight: '30px' })
    const quoteStyle = getComputedStyle(screen.getByRole('blockquote').element())
    expect(quoteStyle.borderLeftWidth).toBe('0px')
    expect(quoteStyle.borderRightWidth).toBe('3px')
    await expect
      .element(screen.getByText('hello(world)', { exact: true }))
      .toHaveStyle({ direction: 'ltr' })
  },
)

it('preserves left-to-right prose, list indentation and quote borders', async () => {
  vi.mocked(useLocale).mockReturnValue('en-US')
  const screen = await render(
    <Markdown content={'Hello\n\n- First item\n\n> Quote'} mode="static" />,
  )
  await expect.element(screen.getByText('Hello', { exact: true })).toHaveStyle({ direction: 'ltr' })
  await expect
    .element(screen.getByRole('list'))
    .toHaveStyle({ paddingLeft: '30px', paddingRight: '0px' })
  const quoteStyle = getComputedStyle(screen.getByRole('blockquote').element())
  expect(quoteStyle.borderLeftWidth).toBe('3px')
  expect(quoteStyle.borderRightWidth).toBe('0px')
})
