import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import LabelSelector from '../selector'

// Mock useTags hook with controlled test data
const mockTags = [
  { name: 'agent', label: 'Agent' },
  { name: 'rag', label: 'RAG' },
  { name: 'search', label: 'Search' },
  { name: 'image', label: 'Image' },
]

vi.mock('@/app/components/plugins/hooks', () => ({
  useTags: () => ({
    tags: mockTags,
    tagsMap: mockTags.reduce((acc, tag) => ({ ...acc, [tag.name]: tag }), {}),
    getTagLabel: (name: string) => mockTags.find((t) => t.name === name)?.label ?? name,
  }),
}))

const setup = () => {
  const onChange = vi.fn()
  const Harness = () => {
    const [value, setValue] = useState<string[]>([])
    return (
      <LabelSelector
        value={value}
        onChange={(next) => {
          setValue(next)
          onChange(next)
        }}
      />
    )
  }
  render(<Harness />)
  return { user: userEvent.setup(), onChange }
}

it('adds and removes labels while displaying the controlled selection', async () => {
  const { user, onChange } = setup()
  const trigger = screen.getByRole('button', {
    name: 'tools.createTool.toolInput.labelPlaceholder',
  })
  await user.click(trigger)
  const popup = within(screen.getByRole('dialog'))
  await user.click(popup.getByRole('checkbox', { name: 'Agent' }))
  expect(onChange).toHaveBeenLastCalledWith(['agent'])
  await user.click(popup.getByRole('checkbox', { name: 'RAG' }))
  expect(onChange).toHaveBeenLastCalledWith(['agent', 'rag'])
  expect(trigger).toHaveTextContent('Agent, RAG')
  await user.click(popup.getByRole('checkbox', { name: 'Agent' }))
  expect(onChange).toHaveBeenLastCalledWith(['rag'])
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(trigger).toHaveTextContent('RAG')
  await user.click(trigger)
  expect(screen.getByRole('checkbox', { name: 'RAG' })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: 'Agent' })).not.toBeChecked()
})

it('filters by tag name, reports no matches, and restores choices when cleared', async () => {
  const { user } = setup()
  await user.click(
    screen.getByRole('button', { name: 'tools.createTool.toolInput.labelPlaceholder' }),
  )
  const search = screen.getByRole('searchbox', { name: 'common.operation.search' })
  await user.type(search, 'rag')
  await waitFor(() =>
    expect(screen.queryByRole('checkbox', { name: 'Agent' })).not.toBeInTheDocument(),
  )
  expect(screen.getByRole('checkbox', { name: 'RAG' })).toBeInTheDocument()
  await user.type(search, 'missing')
  expect(await screen.findByText('common.tag.noTag')).toBeInTheDocument()
  await user.clear(search)
  expect(screen.getByRole('checkbox', { name: 'Agent' })).toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: 'RAG' })).toBeInTheDocument()
})
