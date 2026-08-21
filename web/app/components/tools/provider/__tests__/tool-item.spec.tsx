import type { Collection, Tool } from '../../types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vite-plus/test'
import ToolItem from '../tool-item'

vi.mock('@/i18n-config/language', () => ({ getLanguage: () => 'en_US' }))
vi.mock(
  '@/app/components/app/configuration/config/agent/agent-tools/setting-built-in-tool',
  () => ({
    default: ({
      onHide,
      showReadOnlySettingDetails,
    }: {
      onHide: () => void
      showReadOnlySettingDetails?: boolean
    }) => (
      <div
        data-testid="tool-detail"
        data-show-readonly-setting-details={showReadOnlySettingDetails}
      >
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
  it('opens and closes tool details from the keyboard', async () => {
    const user = userEvent.setup()
    render(<ToolItem collection={collection} tool={tool} isBuiltIn isModel={false} />)

    const toolButton = screen.getByRole('button', { name: 'Tool label' })
    toolButton.focus()
    await user.keyboard('{Enter}')

    expect(screen.getByTestId('tool-detail')).toBeInTheDocument()
    expect(screen.getByTestId('tool-detail')).toHaveAttribute(
      'data-show-readonly-setting-details',
      'true',
    )

    await user.click(screen.getByRole('button', { name: 'Close details' }))
    expect(screen.queryByTestId('tool-detail')).not.toBeInTheDocument()
  })

  it('does not open tool details when disabled', async () => {
    const user = userEvent.setup()
    render(<ToolItem collection={collection} tool={tool} isBuiltIn isModel={false} disabled />)

    const toolButton = screen.getByRole('button', { name: 'Tool label' })
    expect(toolButton).toBeDisabled()
    await user.click(toolButton)

    expect(screen.queryByTestId('tool-detail')).not.toBeInTheDocument()
  })
})
