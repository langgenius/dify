import type { MetadataItemWithValue } from '../../types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { DataType, isShowManageMetadataLocalStorageKey } from '../../types'
import InfoGroup from '../info-group'

const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('@/next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'datasets.byDatasetId.metadata.get': async () => ({
        doc_metadata: [{ id: '3', name: 'category', type: DataType.string }],
      }),
    }),
  }
})
const list: MetadataItemWithValue[] = [
  { id: '1', name: 'title', type: DataType.string, value: 'Guide' },
  { id: '2', name: 'rating', type: DataType.number, value: 0 },
]

afterEach(() => localStorage.removeItem(isShowManageMetadataLocalStorageKey))

it('shows values including zero while withholding editing controls in read-only mode', () => {
  render(<InfoGroup dataSetId="ds-1" list={list} />)
  expect(screen.getByText('Guide')).toBeInTheDocument()
  expect(screen.getByText('0')).toBeInTheDocument()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'common.operation.remove' })).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'dataset.metadata.addMetadata' }),
  ).not.toBeInTheDocument()
})

it('edits and removes the identified metadata item', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  const onDelete = vi.fn()
  function Harness() {
    const [items, setItems] = useState(list)
    return (
      <InfoGroup
        dataSetId="ds-1"
        list={items}
        isEdit
        onChange={(item) => {
          onChange(item)
          setItems((previous) => previous.map((value) => (value.id === item.id ? item : value)))
        }}
        onDelete={onDelete}
      />
    )
  }
  render(<Harness />)
  await user.type(screen.getByRole('textbox', { name: 'title' }), ' updated')
  expect(onChange).toHaveBeenLastCalledWith({ ...list[0], value: 'Guide updated' })
  await user.click(screen.getAllByRole('button', { name: 'common.operation.remove' })[1]!)
  expect(onDelete).toHaveBeenCalledWith(list[1])
})

it('forwards a selected dataset field with its identity', async () => {
  const user = userEvent.setup()
  const onSelect = vi.fn()
  render(<InfoGroup dataSetId="ds-1" list={list} isEdit onSelect={onSelect} />)
  await user.click(screen.getByRole('button', { name: 'dataset.metadata.addMetadata' }))
  await user.click(await screen.findByRole('option', { name: /category/ }))
  expect(onSelect).toHaveBeenCalledWith({ id: '3', name: 'category', type: DataType.string })
})

it('opens metadata management on the documents page', async () => {
  const user = userEvent.setup()
  render(<InfoGroup dataSetId="ds-1" list={list} isEdit />)
  await user.click(screen.getByRole('button', { name: 'dataset.metadata.addMetadata' }))
  await user.click(
    await screen.findByRole('button', { name: 'dataset.metadata.selectMetadata.manageAction' }),
  )
  expect(localStorage.getItem(isShowManageMetadataLocalStorageKey)).toBe('true')
  expect(push).toHaveBeenCalledWith('/datasets/ds-1/documents')
})
