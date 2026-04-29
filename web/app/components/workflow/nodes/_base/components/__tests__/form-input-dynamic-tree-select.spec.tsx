import type { FormOption } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import FormInputDynamicTreeSelect from '../form-input-dynamic-tree-select'

const treeOptions = [
  {
    value: 'parent-a',
    label: { en_US: 'Parent A' },
    children: [
      {
        value: 'child-a1',
        label: { en_US: 'Child A1' },
      },
      {
        value: 'child-a2',
        label: { en_US: 'Child A2' },
      },
    ],
  },
  {
    value: 'parent-b',
    label: { en_US: 'Parent B' },
  },
] as FormOption[]

const StatefulTreeSelect = ({
  initialValue = [],
  multiple = false,
}: {
  initialValue?: string[]
  multiple?: boolean
}) => {
  const [value, setValue] = useState<string[]>(initialValue)
  return (
    <FormInputDynamicTreeSelect
      language="en_US"
      options={treeOptions}
      value={value}
      multiple={multiple}
      onChange={setValue}
      placeholder="Pick one"
    />
  )
}

describe('FormInputDynamicTreeSelect', () => {
  it('should render placeholder when no value is selected', () => {
    render(
      <FormInputDynamicTreeSelect
        language="en_US"
        options={treeOptions}
        value={[]}
        onChange={vi.fn()}
        placeholder="Pick one"
      />,
    )

    expect(screen.getByRole('button', { name: 'Pick one' })).toBeInTheDocument()
  })

  it('should update single selection and close popover when multiple is false', async () => {
    render(<StatefulTreeSelect />)

    fireEvent.click(screen.getByRole('button', { name: 'Pick one' }))
    fireEvent.click(screen.getByRole('option', { name: 'Child A1' }))

    expect(screen.getByRole('button', { name: 'Child A1' })).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByRole('option', { name: 'Child A2' })).not.toBeInTheDocument()
    })
  })

  it('should toggle multiple values when multiple is true', () => {
    render(<StatefulTreeSelect multiple />)

    fireEvent.click(screen.getByRole('button', { name: 'Pick one' }))
    fireEvent.click(screen.getByRole('option', { name: 'Parent A' }))
    expect(screen.getByRole('button', { name: 'Parent A' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('option', { name: 'Parent B' }))
    expect(screen.getByRole('button', { name: 'Parent A, Parent B' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('option', { name: 'Parent A' }))
    expect(screen.getByRole('button', { name: 'Parent B' })).toBeInTheDocument()
  })

  it('should collapse and expand a parent via the dedicated toggle button', () => {
    render(<StatefulTreeSelect />)

    fireEvent.click(screen.getByRole('button', { name: 'Pick one' }))
    expect(screen.getByRole('option', { name: 'Child A1' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }))
    expect(screen.queryByRole('option', { name: 'Child A1' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Expand' }))
    expect(screen.getByRole('option', { name: 'Child A1' })).toBeInTheDocument()
  })
})
