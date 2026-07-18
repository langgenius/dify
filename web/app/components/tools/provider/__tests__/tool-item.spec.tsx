import type { Collection, Tool } from '../../types'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ToolItem from '../tool-item'

vi.mock('@/i18n-config/language', () => ({ getLanguage: () => 'en_US' }))
vi.mock(
  '@/app/components/app/configuration/config/agent/agent-tools/setting-built-in-tool',
  () => ({
    default: ({ onHide }: { onHide: () => void }) => (
      <div data-testid="tool-detail">
        <button onClick={onHide}>Close details</button>
      </div>
    ),
  }),
)

const collection = {
  id: 'collection-id',
  name: 'collection',
  label: { en_US: 'Collection' },
  description: { en_US: 'Description' },
} as Collection

const tool = {
  name: 'tool',
  label: { en_US: 'Tool label' },
  description: { en_US: 'Tool description' },
} as Tool

describe('ToolItem', () => {
  it('opens and closes tool details', () => {
    render(<ToolItem collection={collection} tool={tool} isBuiltIn isModel={false} />)

    fireEvent.click(screen.getByText('Tool label'))
    expect(screen.getByTestId('tool-detail')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close details' }))
    expect(screen.queryByTestId('tool-detail')).not.toBeInTheDocument()
  })

  it('does not open tool details when disabled', () => {
    render(<ToolItem collection={collection} tool={tool} isBuiltIn isModel={false} disabled />)

    fireEvent.click(screen.getByText('Tool label'))

    expect(screen.queryByTestId('tool-detail')).not.toBeInTheDocument()
  })
})
