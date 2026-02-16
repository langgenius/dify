import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import ModelDisplay from './model-display'

vi.mock('../model-name', () => ({
  default: ({ modelItem }: { modelItem: { model: string } }) => <div>{modelItem.model}</div>,
}))

describe('ModelDisplay', () => {
  it('should render model name when model is present', () => {
    const currentModel = { model: 'gpt-4' }
    render(<ModelDisplay currentModel={currentModel} modelId="gpt-4" />)
    expect(screen.getByText('gpt-4')).toBeInTheDocument()
  })

  it('should render modelID when currentModel is missing', () => {
    render(<ModelDisplay currentModel={null} modelId="unknown-model" />)
    expect(screen.getByText('unknown-model')).toBeInTheDocument()
  })
})
