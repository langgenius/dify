import type { ReactNode } from 'react'
import type { ExtraProps } from 'streamdown'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { previewImage } from '@/test/fixtures/preview-files'
import Paragraph from '../paragraph'

const renderParagraph = (
  nodeChildren: NonNullable<ExtraProps['node']>['children'],
  children: ReactNode,
) => {
  const node: NonNullable<ExtraProps['node']> = {
    type: 'element',
    tagName: 'p',
    properties: {},
    children: nodeChildren,
  }
  return render(<Paragraph node={node}>{children}</Paragraph>)
}

it('keeps ordinary Markdown text in paragraph semantics', async () => {
  const screen = await renderParagraph(
    [
      { type: 'comment', value: 'A comment' },
      { type: 'text', value: 'Hello world' },
    ],
    'Hello world',
  )

  await expect.element(screen.getByText('Hello world')).toHaveRole('paragraph')
})

it('decodes a leading image, preserves its caption and restores focus after preview', async () => {
  const screen = await renderParagraph(
    [{ type: 'element', tagName: 'img', properties: { src: previewImage }, children: [] }],
    ['Image', <span key="caption">Architecture caption</span>],
  )

  const preview = screen.getByRole('button', { name: /imageGallery\.previewImage/ })
  await expect.element(preview).toBeVisible()
  const thumbnail = screen.getByTestId('gallery-image')
  await expect.element(thumbnail).toBeVisible()
  const image = thumbnail.element()
  if (!(image instanceof HTMLImageElement)) throw new TypeError('Expected an image')
  await image.decode()
  expect([image.naturalWidth, image.naturalHeight]).toEqual([80, 60])
  await expect.element(screen.getByText('Architecture caption')).toBeVisible()

  await preview.click()
  await expect
    .element(screen.getByRole('dialog', { name: 'workflow.common.preview' }))
    .toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect
    .element(screen.getByRole('dialog', { name: 'workflow.common.preview' }))
    .not.toBeInTheDocument()
  await expect.element(preview).toHaveFocus()
})
