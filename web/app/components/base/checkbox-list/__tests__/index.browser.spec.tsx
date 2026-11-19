import type { ComponentProps } from 'react'
import { useState } from 'react'
import { page as screen, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { CheckboxList } from '..'

function ControlledList(props: ComponentProps<typeof CheckboxList>) {
  const [value, setValue] = useState(props.value ?? [])
  return (
    <>
      <CheckboxList
        {...props}
        value={value}
        onChange={(next) => {
          setValue(next)
        }}
      />
      <output aria-label="Selected values">{JSON.stringify(value)}</output>
    </>
  )
}

describe('checkbox list component', () => {
  beforeEach(async () => {
    await screen.viewport(800, 600)
  })
  const selectAllName = 'common.operation.selectAll'
  const getSearchInput = () => screen.getByRole('searchbox', { name: 'common.operation.search' })
  const options = [
    { label: 'Option 1', value: 'option1' },
    { label: 'Option 2', value: 'option2' },
    { label: 'Option 3', value: 'option3' },
    { label: 'Apple', value: 'apple' },
  ]

  it('renders with title, description and options', async () => {
    await render(
      <ControlledList title="Test Title" description="Test Description" options={options} />,
    )
    await expect.element(screen.getByText('Test Title')).toBeInTheDocument()
    await expect.element(screen.getByText('Test Description')).toBeInTheDocument()
    await expect
      .element(screen.getByRole('group', { name: 'Test Title' }))
      .toHaveAccessibleDescription('Test Description')
    for (const option of options) {
      await expect.element(screen.getByText(option.label)).toBeVisible()
    }
  })

  it('filters options by label', async () => {
    await render(<ControlledList options={options} />)

    const input = getSearchInput()
    await input.fill('app')

    await expect.element(screen.getByText('Apple')).toBeInTheDocument()
    await expect.element(screen.getByText('Option 2')).not.toBeInTheDocument()
    await expect.element(screen.getByText('Option 3')).not.toBeInTheDocument()
  })

  it('selects all options when select-all is clicked', async () => {
    await render(<ControlledList options={options} value={[]} showSelectAll />)

    const selectAll = screen.getByRole('checkbox', { name: selectAllName })
    await selectAll.click()

    await expect
      .element(screen.getByRole('status', { name: 'Selected values' }))
      .toHaveTextContent(JSON.stringify(['option1', 'option2', 'option3', 'apple']))
    await expect.element(selectAll).toBeChecked()
    await userEvent.keyboard(' ')
    await expect.element(selectAll).not.toBeChecked()
    await expect.element(screen.getByRole('checkbox', { name: 'Option 1' })).not.toBeChecked()
    await expect
      .element(screen.getByRole('status', { name: 'Selected values' }))
      .toHaveTextContent('[]')
  })

  it('deselects all options when select-all is clicked', async () => {
    await render(
      <ControlledList
        options={options}
        value={['option1', 'option2', 'option3', 'apple']}
        showSelectAll
      />,
    )

    const selectAll = screen.getByRole('checkbox', { name: selectAllName })
    await expect.element(selectAll).toBeChecked()
    await selectAll.click()

    await expect
      .element(screen.getByRole('status', { name: 'Selected values' }))
      .toHaveTextContent(JSON.stringify([]))
  })

  it('hides select-all checkbox when searching', async () => {
    await render(<ControlledList options={options} />)
    await getSearchInput().fill('app')
    await expect
      .element(screen.getByRole('checkbox', { name: selectAllName }))
      .not.toBeInTheDocument()
  })

  it('selects options when checkbox is clicked', async () => {
    await render(<ControlledList options={options} value={[]} showSelectAll={false} />)

    const selectOption = screen.getByRole('checkbox', { name: 'Option 1' })
    await selectOption.click()
    await expect.element(selectOption).toBeChecked()
    await expect
      .element(screen.getByRole('status', { name: 'Selected values' }))
      .toHaveTextContent(JSON.stringify(['option1']))
  })

  it('deselects options when checkbox is clicked when selected', async () => {
    await render(<ControlledList options={options} value={['option1']} showSelectAll={false} />)

    const selectOption = screen.getByRole('checkbox', { name: 'Option 1' })
    await selectOption.click()
    await expect
      .element(screen.getByRole('status', { name: 'Selected values' }))
      .toHaveTextContent(JSON.stringify([]))
  })

  it('keeps a disabled list unavailable', async () => {
    await render(<ControlledList options={options} value={[]} disabled />)

    const selectOption = screen.getByRole('checkbox', { name: 'Option 1' })
    await expect.element(screen.getByRole('checkbox', { name: selectAllName })).toBeDisabled()
    await expect.element(selectOption).toBeDisabled()
    await expect
      .element(screen.getByRole('status', { name: 'Selected values' }))
      .toHaveTextContent('[]')
  })

  it('Reset button works', async () => {
    await render(<ControlledList options={options} value={[]} />)

    const input = getSearchInput()
    await input.fill('ban')
    await expect.element(screen.getByText(/common.operation.noSearchResults/)).toBeVisible()
    await screen.getByRole('button', { name: 'common.operation.resetKeywords' }).click()
    await expect.element(input).toHaveValue('')
    await expect.element(screen.getByRole('checkbox', { name: 'Apple' })).toBeInTheDocument()
    await expect
      .element(screen.getByRole('status', { name: 'Selected values' }))
      .toHaveTextContent('[]')
  })

  it('keeps disabled options unavailable', async () => {
    const disabledOptions = [
      { label: 'Enabled', value: 'enabled' },
      { label: 'Disabled', value: 'disabled', disabled: true },
    ]

    await render(<ControlledList options={disabledOptions} value={[]} />)

    const disabledCheckbox = screen.getByRole('checkbox', { name: 'Disabled' })
    await expect.element(disabledCheckbox).toBeDisabled()
    await expect
      .element(screen.getByRole('status', { name: 'Selected values' }))
      .toHaveTextContent('[]')
  })

  it('renders with label prop', async () => {
    await render(<ControlledList options={options} label="Test Label" />)
    await expect.element(screen.getByText('Test Label')).toBeInTheDocument()
    await expect.element(screen.getByRole('group', { name: 'Test Label' })).toBeInTheDocument()
  })

  it('renders without showSelectAll, showCount, showSearch', async () => {
    await render(
      <ControlledList
        options={options}
        showSelectAll={false}
        showCount={false}
        showSearch={false}
      />,
    )
    await expect
      .element(screen.getByRole('checkbox', { name: selectAllName }))
      .not.toBeInTheDocument()
    for (const option of options) {
      await expect.element(screen.getByText(option.label)).toBeVisible()
    }
  })

  it('shows indeterminate state when some options are selected', async () => {
    await render(<ControlledList options={options} value={['option1', 'option2']} showSelectAll />)
    // When some but not all options are selected, clicking select-all should select all remaining options
    const selectAll = screen.getByRole('checkbox', { name: selectAllName })
    await expect.element(selectAll).toBeInTheDocument()
    await expect.element(selectAll).toHaveAttribute('aria-checked', 'mixed')

    await selectAll.click()
    await expect
      .element(screen.getByRole('status', { name: 'Selected values' }))
      .toHaveTextContent(JSON.stringify(['option1', 'option2', 'option3', 'apple']))
  })

  it('shows no data message when no options match search', async () => {
    await render(<ControlledList options={options} />)

    const input = getSearchInput()
    await input.fill('xyz')

    await expect.element(screen.getByText(/common.operation.noSearchResults/i)).toBeInTheDocument()
  })

  it('shows correct filtered count message when searching', async () => {
    await render(<ControlledList options={options} title="Items" />)

    const input = getSearchInput()
    await input.fill('opt')

    await expect
      .element(screen.getByText(/operation.searchCount/i))
      .toHaveTextContent('common.operation.searchCount:{"count":3,"content":"Items"}')
  })

  it('shows no data message when no options are provided', async () => {
    await render(<ControlledList options={[]} />)
    await expect.element(screen.getByText('common.noData')).toBeInTheDocument()
  })
})
