import { render, screen } from '@testing-library/react'
import ChunkingModeLabel from '../chunking-mode-label'

describe('ChunkingModeLabel', () => {
  it.each([
    {
      isGeneralMode: true,
      isQAMode: false,
      label: 'dataset.chunkingMode.general',
    },
    {
      isGeneralMode: true,
      isQAMode: true,
      label: 'dataset.chunkingMode.general · QA',
    },
    {
      isGeneralMode: false,
      isQAMode: true,
      label: 'dataset.chunkingMode.parentChild',
    },
  ])('displays $label for a supported chunking mode', ({ isGeneralMode, isQAMode, label }) => {
    render(<ChunkingModeLabel isGeneralMode={isGeneralMode} isQAMode={isQAMode} />)

    expect(screen.getByText(label)).toBeInTheDocument()
  })
})
