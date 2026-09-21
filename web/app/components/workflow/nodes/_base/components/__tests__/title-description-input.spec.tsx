import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DescriptionInput, TitleInput } from '../title-description-input'

describe('Node title and description fields', () => {
  it('keeps labels associated with populated fields and activates the named control', async () => {
    const user = userEvent.setup()
    render(
      <>
        <TitleInput value="Summarize" onBlur={vi.fn()} />
        <DescriptionInput value="Summarize the document" onChange={vi.fn()} />
      </>,
    )

    const title = screen.getByRole('textbox', { name: 'workflow.common.nodeTitle' })
    const description = screen.getByRole('textbox', { name: 'workflow.common.nodeDescription' })
    expect(title).toHaveValue('Summarize')
    expect(description).toHaveValue('Summarize the document')

    await user.click(screen.getByText('workflow.common.nodeTitle'))
    expect(title).toHaveFocus()
    await user.click(screen.getByText('workflow.common.nodeDescription'))
    expect(description).toHaveFocus()
  })

  it('commits a title with Enter and restores its previous value when cleared', async () => {
    const user = userEvent.setup()
    const onBlur = vi.fn()
    render(<TitleInput value="Summarize" onBlur={onBlur} />)
    const title = screen.getByRole('textbox', { name: 'workflow.common.nodeTitle' })

    await user.click(title)
    await user.clear(title)
    await user.type(title, 'Translate{Enter}')
    expect(onBlur).toHaveBeenLastCalledWith('Translate')

    await user.clear(title)
    await user.tab()
    expect(title).toHaveValue('Summarize')
    expect(onBlur).toHaveBeenLastCalledWith('Summarize')
  })
})
