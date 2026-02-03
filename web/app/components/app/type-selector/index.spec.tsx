import { fireEvent, render, screen, within } from '@testing-library/react'
import * as React from 'react'
import { AppModeEnum } from '@/types/app'
import AppTypeSelector, { AppTypeIcon, AppTypeLabel } from './index'

describe('AppTypeSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Covers default rendering and the closed dropdown state.
  describe('Rendering', () => {
    it('should render "all types" trigger when no types selected', () => {
      render(<AppTypeSelector value={[]} onChange={vi.fn()} />)

      expect(screen.getByText('app.typeSelector.all')).toBeInTheDocument()
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    })
  })

  // Covers prop-driven trigger variants (empty, single, multiple).
  describe('Props', () => {
    it('should render selected type label and clear button when a single type is selected', () => {
      render(<AppTypeSelector value={[AppModeEnum.CHAT]} onChange={vi.fn()} />)

      expect(screen.getByText('app.typeSelector.chatbot')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'common.operation.clear' })).toBeInTheDocument()
    })

    it('should render icon-only trigger when multiple types are selected', () => {
      render(<AppTypeSelector value={[AppModeEnum.CHAT, AppModeEnum.WORKFLOW]} onChange={vi.fn()} />)

      expect(screen.queryByText('app.typeSelector.all')).not.toBeInTheDocument()
      expect(screen.queryByText('app.typeSelector.chatbot')).not.toBeInTheDocument()
      expect(screen.queryByText('app.typeSelector.workflow')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'common.operation.clear' })).toBeInTheDocument()
    })
  })

  // Covers opening/closing the dropdown and selection updates.
  describe('User interactions', () => {
    it('should toggle option list when clicking the trigger', () => {
      render(<AppTypeSelector value={[]} onChange={vi.fn()} />)

      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

      fireEvent.click(screen.getByText('app.typeSelector.all'))
      expect(screen.getByRole('tooltip')).toBeInTheDocument()

      fireEvent.click(screen.getByText('app.typeSelector.all'))
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    })

    it('should call onChange with added type when selecting an unselected item', () => {
      const onChange = vi.fn()
      render(<AppTypeSelector value={[]} onChange={onChange} />)

      fireEvent.click(screen.getByText('app.typeSelector.all'))
      fireEvent.click(within(screen.getByRole('tooltip')).getByText('app.typeSelector.workflow'))

      expect(onChange).toHaveBeenCalledWith([AppModeEnum.WORKFLOW])
    })

    it('should call onChange with removed type when selecting an already-selected item', () => {
      const onChange = vi.fn()
      render(<AppTypeSelector value={[AppModeEnum.WORKFLOW]} onChange={onChange} />)

      fireEvent.click(screen.getByText('app.typeSelector.workflow'))
      fireEvent.click(within(screen.getByRole('tooltip')).getByText('app.typeSelector.workflow'))

      expect(onChange).toHaveBeenCalledWith([])
    })

    it('should call onChange with appended type when selecting an additional item', () => {
      const onChange = vi.fn()
      render(<AppTypeSelector value={[AppModeEnum.CHAT]} onChange={onChange} />)

      fireEvent.click(screen.getByText('app.typeSelector.chatbot'))
      fireEvent.click(within(screen.getByRole('tooltip')).getByText('app.typeSelector.agent'))

      expect(onChange).toHaveBeenCalledWith([AppModeEnum.CHAT, AppModeEnum.AGENT_CHAT])
    })

    it('should clear selection without opening the dropdown when clicking clear button', () => {
      const onChange = vi.fn()
      render(<AppTypeSelector value={[AppModeEnum.CHAT]} onChange={onChange} />)

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.clear' }))

      expect(onChange).toHaveBeenCalledWith([])
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    })
  })
})

describe('AppTypeLabel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Covers label mapping for each supported app type.
  it.each([
    [AppModeEnum.CHAT, 'app.typeSelector.chatbot'],
    [AppModeEnum.AGENT_CHAT, 'app.typeSelector.agent'],
    [AppModeEnum.COMPLETION, 'app.typeSelector.completion'],
    [AppModeEnum.ADVANCED_CHAT, 'app.typeSelector.advanced'],
    [AppModeEnum.WORKFLOW, 'app.typeSelector.workflow'],
  ] as const)('should render label %s for type %s', (_type, expectedLabel) => {
    render(<AppTypeLabel type={_type} />)
    expect(screen.getByText(expectedLabel)).toBeInTheDocument()
  })

  // Covers fallback behavior for unexpected app mode values.
  it('should render empty label for unknown type', () => {
    const { container } = render(<AppTypeLabel type={'unknown' as AppModeEnum} />)
    expect(container.textContent).toBe('')
  })
})

describe('AppTypeIcon', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Covers icon rendering for each supported app type.
  it.each([
    [AppModeEnum.CHAT],
    [AppModeEnum.AGENT_CHAT],
    [AppModeEnum.COMPLETION],
    [AppModeEnum.ADVANCED_CHAT],
    [AppModeEnum.WORKFLOW],
  ] as const)('should render icon for type %s', (type) => {
    const { container } = render(<AppTypeIcon type={type} />)
    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  // Covers fallback behavior for unexpected app mode values.
  it('should render nothing for unknown type', () => {
    const { container } = render(<AppTypeIcon type={'unknown' as AppModeEnum} />)
    expect(container.firstChild).toBeNull()
  })
})
