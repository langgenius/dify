import type { ComponentProps } from 'react'
import { useState } from 'react'
import { page as screen, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import TagInput from '../index'

const mockNotify = vi.fn()

vi.mock('@/app/notifications', () => ({
  toast: { error: (message: string) => mockNotify({ type: 'error', message }) },
}))

type TagInputProps = ComponentProps<typeof TagInput>

function ControlledTags(props: Partial<TagInputProps>) {
  const [items, setItems] = useState(props.items ?? [])
  return (
    <>
      <label htmlFor="recipient-tags">Recipients</label>
      <TagInput {...props} id="recipient-tags" items={items} onChange={setItems} />
      <output aria-label="Tags">{JSON.stringify(items)}</output>
      <button>Next field</button>
    </>
  )
}

const renderTagInput = async (props: Partial<TagInputProps> = {}) => {
  await render(<ControlledTags {...props} />)
}

describe('TagInput', () => {
  beforeEach(async () => {
    await screen.viewport(800, 600)
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should hide input when add is disabled', async () => {
      await renderTagInput({ disableAdd: true })

      await expect.element(screen.getByRole('textbox')).not.toBeInTheDocument()
    })

    it('should hide remove controls when remove is disabled', async () => {
      await renderTagInput({ items: ['alpha'], disableRemove: true })

      await expect
        .element(screen.getByRole('button', { name: 'common.operation.remove alpha' }))
        .not.toBeInTheDocument()
    })
  })

  it('associates an external label with the tag entry input', async () => {
    await renderTagInput()

    const input = screen.getByRole('textbox', { name: 'Recipients' })
    await screen.getByText('Recipients').click()
    await expect.element(input).toHaveFocus()
    await userEvent.keyboard('alice')
    await expect.element(input).toHaveValue('alice')
    await userEvent.keyboard('{Enter}')
    await expect
      .element(screen.getByRole('status', { name: 'Tags' }))
      .toHaveTextContent('["alice"]')
  })

  describe('User Interactions', () => {
    it('should remove item when remove control is clicked', async () => {
      await renderTagInput({ items: ['alpha', 'beta'] })

      const removeControl = screen.getByRole('button', { name: 'common.operation.remove alpha' })

      await removeControl.click()
      await expect.element(removeControl).not.toBeInTheDocument()
      await expect
        .element(screen.getByRole('button', { name: 'common.operation.remove beta' }))
        .toBeVisible()

      await expect
        .element(screen.getByRole('status', { name: 'Tags' }))
        .toHaveTextContent(JSON.stringify(['beta']))
    })

    it('should add trimmed tag on Enter and clear input', async () => {
      await renderTagInput()
      const input = screen.getByRole('textbox')

      await input.fill('  new-tag  ')
      await userEvent.keyboard('{Enter}')

      await expect
        .element(screen.getByRole('status', { name: 'Tags' }))
        .toHaveTextContent(JSON.stringify(['new-tag']))
      await expect.element(input).toHaveValue('')
      await expect
        .element(screen.getByRole('button', { name: 'common.operation.remove new-tag' }))
        .toBeVisible()
    })

    it('should add tag on blur when input has valid value', async () => {
      await renderTagInput()
      const input = screen.getByRole('textbox')

      await input.fill('blur-tag')
      await screen.getByRole('button', { name: 'Next field' }).click()

      await expect
        .element(screen.getByRole('status', { name: 'Tags' }))
        .toHaveTextContent(JSON.stringify(['blur-tag']))
    })

    it('should append return marker on Enter and confirm on Tab in special mode', async () => {
      await renderTagInput({ customizedConfirmKey: 'Tab' })
      const input = screen.getByRole('textbox')

      await input.fill('stop')
      await userEvent.keyboard('{Enter}')

      await expect.element(input).toHaveValue('stop↵')
      await expect
        .element(screen.getByRole('status', { name: 'Tags' }))
        .toHaveTextContent(JSON.stringify([]))

      await userEvent.keyboard('{Tab}')
      await expect.element(input).toHaveFocus()
      await expect
        .element(screen.getByRole('status', { name: 'Tags' }))
        .toHaveTextContent(JSON.stringify(['stop↵']))
      await expect.element(input).toHaveValue('')
      await expect
        .element(screen.getByRole('button', { name: 'common.operation.remove stop↵' }))
        .toBeVisible()
    })
  })

  describe('Validation', () => {
    it('should notify duplicate error when tag already exists', async () => {
      await renderTagInput({ items: ['dup-tag'] })
      const input = screen.getByRole('textbox')

      await input.fill('dup-tag')
      await userEvent.keyboard('{Enter}')

      await expect
        .element(screen.getByRole('status', { name: 'Tags' }))
        .toHaveTextContent(JSON.stringify(['dup-tag']))
      expect(mockNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'datasetDocuments.segment.keywordDuplicate',
      })
    })

    it('should notify length error when tag is longer than 20 chars', async () => {
      await renderTagInput()
      const input = screen.getByRole('textbox')

      await input.fill('a'.repeat(21))
      await userEvent.keyboard('{Enter}')

      await expect
        .element(screen.getByRole('status', { name: 'Tags' }))
        .toHaveTextContent(JSON.stringify([]))
      expect(mockNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'datasetDocuments.segment.keywordError',
      })
    })

    it('should notify required error when value is empty and required is true', async () => {
      await renderTagInput({ required: true })
      const input = screen.getByRole('textbox')

      await input.fill('   ')
      await screen.getByRole('button', { name: 'Next field' }).click()

      await expect
        .element(screen.getByRole('status', { name: 'Tags' }))
        .toHaveTextContent(JSON.stringify([]))
      expect(mockNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'datasetDocuments.segment.keywordEmpty',
      })
    })

    it('should ignore empty value when required is false', async () => {
      await renderTagInput({ required: false })
      const input = screen.getByRole('textbox')

      await input.fill('   ')
      await screen.getByRole('button', { name: 'Next field' }).click()

      await expect
        .element(screen.getByRole('status', { name: 'Tags' }))
        .toHaveTextContent(JSON.stringify([]))
      expect(mockNotify).not.toHaveBeenCalled()
    })
  })
})
