import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import dayjs from '@/app/components/base/date-and-time-picker/utils/dayjs'
import MarkdownForm from './form'

type TextNode = {
  type: 'text'
  value: string
}

type ElementNode = {
  type: 'element'
  tagName: string
  properties: Record<string, unknown>
  children: Array<ElementNode | TextNode>
}

type RootNode = {
  properties: Record<string, unknown>
  children: Array<ElementNode | TextNode>
}

const { mockOnSend, mockFormatDateForOutput } = vi.hoisted(() => ({
  mockOnSend: vi.fn(),
  mockFormatDateForOutput: vi.fn((_date: unknown, includeTime?: boolean) => {
    return includeTime ? 'formatted-datetime' : 'formatted-date'
  }),
}))

vi.mock('@/app/components/base/chat/chat/context', () => ({
  useChatContext: () => ({
    onSend: mockOnSend,
  }),
}))

vi.mock('@/app/components/base/date-and-time-picker/utils/dayjs', async () => {
  const actual = await vi.importActual<typeof import('@/app/components/base/date-and-time-picker/utils/dayjs')>(
    '@/app/components/base/date-and-time-picker/utils/dayjs',
  )
  return {
    ...actual,
    formatDateForOutput: mockFormatDateForOutput,
  }
})

const createTextNode = (value: string): TextNode => ({
  type: 'text',
  value,
})

const createElementNode = (
  tagName: string,
  properties: Record<string, unknown> = {},
  children: Array<ElementNode | TextNode> = [],
): ElementNode => ({
  type: 'element',
  tagName,
  properties,
  children,
})

const createRootNode = (
  children: Array<ElementNode | TextNode>,
  properties: Record<string, unknown> = {},
): RootNode => ({
  properties,
  children,
})

describe('MarkdownForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Render supported tags and fallback output for unsupported tags.
  describe('Rendering', () => {
    it('should render label, inputs, textarea, button, and unsupported tag fallback', () => {
      const node = createRootNode([
        createElementNode('label', { for: 'name' }, [createTextNode('Name')]),
        createElementNode('input', { type: 'text', name: 'name', placeholder: 'Enter name' }),
        createElementNode('textarea', { name: 'bio', placeholder: 'Enter bio' }),
        createElementNode('button', {}, [createTextNode('Submit')]),
        createElementNode('article', {}, [createTextNode('Unsupported child')]),
      ])

      render(<MarkdownForm node={node} />)

      expect(screen.getByText('Name')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('Enter name')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('Enter bio')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument()
      expect(screen.getByText(/Unsupported tag:\s*article/)).toBeInTheDocument()
    })
  })

  // Convert current form values to plain text output by default.
  describe('Text format submission', () => {
    it('should call onSend with text output when dataFormat is not provided', async () => {
      const user = userEvent.setup()
      const node = createRootNode([
        createElementNode('input', { type: 'text', name: 'name', value: 'Alice' }),
        createElementNode('textarea', { name: 'bio', value: 'Hello' }),
        createElementNode('button', {}, [createTextNode('Submit')]),
      ])

      render(<MarkdownForm node={node} />)

      await user.click(screen.getByRole('button', { name: 'Submit' }))

      await waitFor(() => {
        expect(mockOnSend).toHaveBeenCalledWith('name: Alice\nbio: Hello')
      })
    })

    it('should submit updated text input and textarea values after user typing', async () => {
      const user = userEvent.setup()
      const node = createRootNode([
        createElementNode('input', { type: 'text', name: 'name', value: '', placeholder: 'Name input' }),
        createElementNode('textarea', { name: 'bio', value: '', placeholder: 'Bio input' }),
        createElementNode('button', {}, [createTextNode('Submit')]),
      ])

      render(<MarkdownForm node={node} />)

      const nameInput = screen.getByPlaceholderText('Name input')
      const bioInput = screen.getByPlaceholderText('Bio input')
      await user.type(nameInput, 'Bob')
      await user.type(bioInput, 'Hi there')
      await user.click(screen.getByRole('button', { name: 'Submit' }))

      await waitFor(() => {
        expect(mockOnSend).toHaveBeenCalledWith('name: Bob\nbio: Hi there')
      })
    })
  })

  // Emit serialized JSON when data-format requests JSON output.
  describe('JSON format submission', () => {
    it('should call onSend with JSON output when dataFormat is json', async () => {
      const user = userEvent.setup()
      const node = createRootNode(
        [
          createElementNode('input', { type: 'hidden', name: 'token', value: 'secret-token' }),
          createElementNode('input', { type: 'select', name: 'color', value: 'red', dataOptions: ['red', 'blue'] }),
          createElementNode('button', {}, [createTextNode('Send JSON')]),
        ],
        { dataFormat: 'json' },
      )

      render(<MarkdownForm node={node} />)

      await user.click(screen.getByRole('button', { name: 'Send JSON' }))

      await waitFor(() => {
        expect(mockOnSend).toHaveBeenCalledWith('{"token":"secret-token","color":"red"}')
      })
    })

    it('should fallback hidden value to empty string when value is missing', async () => {
      const user = userEvent.setup()
      const node = createRootNode(
        [
          createElementNode('input', { type: 'hidden', name: 'token' }),
          createElementNode('button', {}, [createTextNode('Send JSON')]),
        ],
        { dataFormat: 'json' },
      )

      render(<MarkdownForm node={node} />)

      await user.click(screen.getByRole('button', { name: 'Send JSON' }))

      await waitFor(() => {
        expect(mockOnSend).toHaveBeenCalledWith('{"token":""}')
      })
    })
  })

  // Select options parser should handle both valid and invalid string payloads.
  describe('Select options parsing', () => {
    it('should parse options from data-options string and submit selected value', async () => {
      const user = userEvent.setup()
      const node = createRootNode([
        createElementNode('input', {
          'type': 'select',
          'name': 'city',
          'value': 'Paris',
          'data-options': '["Paris","Tokyo"]',
        }),
        createElementNode('button', {}, [createTextNode('Submit')]),
      ])

      render(<MarkdownForm node={node} />)

      await user.click(screen.getByRole('button', { name: 'Submit' }))

      await waitFor(() => {
        expect(mockOnSend).toHaveBeenCalledWith('city: Paris')
      })
    })

    it('should handle invalid data-options string without crashing', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const node = createRootNode([
        createElementNode('input', {
          'type': 'select',
          'name': 'city',
          'value': 'Paris',
          'data-options': 'not-json',
        }),
        createElementNode('button', {}, [createTextNode('Submit')]),
      ])

      try {
        render(<MarkdownForm node={node} />)

        expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument()
        expect(consoleErrorSpy).toHaveBeenCalled()
      }
      finally {
        consoleErrorSpy.mockRestore()
      }
    })

    it('should update selected value via onSelect and submit the new option', async () => {
      const user = userEvent.setup()
      const node = createRootNode([
        createElementNode('input', {
          type: 'select',
          name: 'city',
          value: 'Paris',
          dataOptions: ['Paris', 'Tokyo'],
        }),
        createElementNode('button', {}, [createTextNode('Submit')]),
      ])

      render(<MarkdownForm node={node} />)

      const triggerText = await screen.findByTitle('Paris')
      await user.click(triggerText)
      await user.click(await screen.findByText('Tokyo'))
      await user.click(screen.getByRole('button', { name: 'Submit' }))

      await waitFor(() => {
        expect(mockOnSend).toHaveBeenCalledWith('city: Tokyo')
      })
    })
  })

  // Date and datetime values should be formatted through shared utility before submission.
  describe('Date formatting', () => {
    it('should format date and datetime values before sending', async () => {
      const user = userEvent.setup()
      const node = createRootNode(
        [
          createElementNode('input', { type: 'date', name: 'startDate', value: dayjs('2026-01-10') }),
          createElementNode('input', { type: 'datetime', name: 'runAt', value: dayjs('2026-01-10T08:30:00') }),
          createElementNode('button', {}, [createTextNode('Submit')]),
        ],
        { dataFormat: 'json' },
      )

      render(<MarkdownForm node={node} />)

      await user.click(screen.getByRole('button', { name: 'Submit' }))

      await waitFor(() => {
        expect(mockFormatDateForOutput).toHaveBeenCalledTimes(2)
        expect(mockFormatDateForOutput).toHaveBeenNthCalledWith(1, expect.anything(), false)
        expect(mockFormatDateForOutput).toHaveBeenNthCalledWith(2, expect.anything(), true)
        expect(mockOnSend).toHaveBeenCalledWith('{"startDate":"formatted-date","runAt":"formatted-datetime"}')
      })
    })
  })

  // Checkbox interactions should update form state and be reflected in submission output.
  describe('Checkbox interaction', () => {
    it('should toggle checkbox value and submit updated value', async () => {
      const user = userEvent.setup()
      const node = createRootNode([
        createElementNode('input', { type: 'checkbox', name: 'acceptTerms', value: false, dataTip: 'Accept terms' }),
        createElementNode('button', {}, [createTextNode('Submit')]),
      ])

      render(<MarkdownForm node={node} />)

      await user.click(screen.getByTestId('checkbox-acceptTerms'))
      await user.click(screen.getByRole('button', { name: 'Submit' }))

      await waitFor(() => {
        expect(mockOnSend).toHaveBeenCalledWith('acceptTerms: true')
      })
    })
  })

  // Native submit event is intentionally blocked at form level.
  describe('Form submit behavior', () => {
    it('should prevent native submit propagation from form onSubmit', () => {
      const parentOnSubmit = vi.fn()
      const node = createRootNode([
        createElementNode('input', { type: 'text', name: 'name', value: 'Alice' }),
        createElementNode('button', {}, [createTextNode('Submit')]),
      ])
      const { container } = render(
        <div onSubmit={parentOnSubmit}>
          <MarkdownForm node={node} />
        </div>,
      )

      const form = container.querySelector('form')
      expect(form).not.toBeNull()
      if (!form)
        throw new Error('Form element not found')

      fireEvent.submit(form)
      expect(parentOnSubmit).not.toHaveBeenCalled()
      expect(mockOnSend).not.toHaveBeenCalled()
    })
  })
})
