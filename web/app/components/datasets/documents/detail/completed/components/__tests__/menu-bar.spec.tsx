import type { ComponentProps } from 'react'
import { CheckboxGroup } from '@langgenius/dify-ui/checkbox-group'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import MenuBar from '../menu-bar'

describe('MenuBar', () => {
  const defaultProps: ComponentProps<typeof MenuBar> = {
    hasSelectableSegments: true,
    isLoading: false,
    totalText: '10 Chunks',
    statusList: [
      { value: 'all', name: 'All' },
      { value: 0, name: 'Enabled' },
      { value: 1, name: 'Disabled' },
    ],
    selectDefaultValue: 'all',
    onChangeStatus: vi.fn(),
    inputValue: '',
    onInputChange: vi.fn(),
    isCollapsed: false,
    toggleCollapsed: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  const renderMenuBar = (props: Partial<typeof defaultProps> = {}) => {
    return render(
      <CheckboxGroup value={[]} onValueChange={vi.fn()} allValues={['seg-1']}>
        <MenuBar {...defaultProps} {...props} />
      </CheckboxGroup>,
    )
  }

  it.each([
    { hasSelectableSegments: true, isLoading: false },
    { hasSelectableSegments: true, isLoading: true },
    { hasSelectableSegments: false, isLoading: false },
  ])(
    'allows bulk selection only for selectable, loaded chunks: %j',
    ({ hasSelectableSegments, isLoading }) => {
      renderMenuBar({ hasSelectableSegments, isLoading })
      expect(screen.getByText('10 Chunks')).toBeInTheDocument()
      const checkbox = screen.queryByRole('checkbox', { name: 'common.operation.selectAll' })
      if (hasSelectableSegments)
        expect(checkbox?.getAttribute('aria-disabled') === 'true').toBe(isLoading)
      else expect(checkbox).not.toBeInTheDocument()
    },
  )

  it('changes the status filter using the full status option, including numeric zero', async () => {
    const user = userEvent.setup()
    renderMenuBar()
    const trigger = screen.getByRole('combobox', {
      name: 'datasetDocuments.segment.statusFilterLabel',
    })
    expect(trigger).toHaveTextContent('All')
    await user.click(trigger)
    await user.click(await screen.findByRole('option', { name: 'Enabled' }))
    expect(defaultProps.onChangeStatus).toHaveBeenCalledExactlyOnceWith({
      value: 0,
      name: 'Enabled',
    })
  })

  it('forwards edits and clear actions from the chunk search field', async () => {
    const user = userEvent.setup()
    renderMenuBar({ inputValue: 'some text' })
    await user.type(screen.getByRole('searchbox', { name: 'common.operation.search' }), '!')
    expect(defaultProps.onInputChange).toHaveBeenLastCalledWith('some text!')
    await user.click(screen.getByRole('button', { name: 'common.operation.clear' }))
    expect(defaultProps.onInputChange).toHaveBeenLastCalledWith('')
  })

  it.each([true, false])(
    'offers the correct chunk display action when collapsed=%s',
    async (isCollapsed) => {
      const user = userEvent.setup()
      renderMenuBar({ isCollapsed })
      await user.click(
        screen.getByRole('button', {
          name: `datasetDocuments.segment.${isCollapsed ? 'expandChunks' : 'collapseChunks'}`,
        }),
      )
      expect(defaultProps.toggleCollapsed).toHaveBeenCalledOnce()
    },
  )
})
