import { fireEvent, screen } from '@testing-library/react'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import {
  JsonEditorField,
  MultiSelectField,
} from '../form-input-item.sections'

describe('form-input-item sections', () => {
  it('should render a loading multi-select label', () => {
    renderWorkflowComponent(
      <MultiSelectField
        disabled={false}
        isLoading
        items={[{ name: 'Alpha', value: 'alpha' }]}
        onChange={vi.fn()}
        selectedLabel=""
        value={[]}
      />,
    )

    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('should render the shared json editor section', () => {
    renderWorkflowComponent(
      <JsonEditorField
        value={'{"enabled":true}'}
        onChange={vi.fn()}
        placeholder={<div>JSON placeholder</div>}
      />,
    )

    expect(screen.getByText('JSON')).toBeInTheDocument()
  })

  it('should render placeholder, icons, and select multi-select options', () => {
    const onChange = vi.fn()

    renderWorkflowComponent(
      <MultiSelectField
        disabled={false}
        items={[
          { name: 'Alpha', value: 'alpha', icon: '/alpha.svg' },
          { name: 'Beta', value: 'beta' },
        ]}
        onChange={onChange}
        placeholder="Choose options"
        selectedLabel=""
        value={[]}
      />,
    )

    expect(screen.getByText('Choose options')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByText('Alpha'))

    expect(document.querySelector('img[src="/alpha.svg"]')).toBeInTheDocument()
    expect(onChange).toHaveBeenCalled()
  })
})
