import type { FormOption } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import DynamicTreeSelectField from '../dynamic-tree-select-field'

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
    <DynamicTreeSelectField
      language="en_US"
      options={treeOptions}
      value={value}
      multiple={multiple}
      onChange={setValue}
      placeholder="Pick one"
    />
  )
}

describe('DynamicTreeSelectField', () => {
  it('should render placeholder when no value is selected', () => {
    render(
      <DynamicTreeSelectField
        language="en_US"
        options={treeOptions}
        value={[]}
        onChange={vi.fn()}
        placeholder="Pick one"
      />,
    )

    expect(screen.getByText('Pick one')).toBeInTheDocument()
  })

  it('should update single selection and close popover when multiple is false', () => {
    render(<StatefulTreeSelect />)

    fireEvent.click(screen.getByRole('button', { name: 'Pick one' }))
    fireEvent.click(screen.getByRole('button', { name: 'Child A1' }))

    expect(screen.getByRole('button', { name: 'Child A1' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Child A2' })).not.toBeInTheDocument()
  })

  it('should toggle multiple values when multiple is true', () => {
    render(<StatefulTreeSelect multiple />)

    fireEvent.click(screen.getByRole('button', { name: 'Pick one' }))
    fireEvent.click(screen.getByRole('button', { name: 'Parent A' }))
    expect(screen.getByRole('button', { name: 'Parent A' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Parent B' }))
    expect(screen.getByRole('button', { name: 'Parent A, Parent B' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Parent A' }))
    expect(screen.getByRole('button', { name: 'Parent B' })).toBeInTheDocument()
  })
})
