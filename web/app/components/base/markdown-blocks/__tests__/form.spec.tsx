import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import dayjs from '@/app/components/base/date-and-time-picker/utils/dayjs'
import MarkdownForm from '../form'

const UNSUPPORTED_TAG_ARTICLE_RE = /Unsupported tag:\s*article/
const UNSUPPORTED_TAG_RE = /Unsupported tag/

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
  type: 'element'
  tagName: 'form'
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
  type: 'element',
  tagName: 'form',
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

      expect(screen.getByText('Name'))!.toBeInTheDocument()
      expect(screen.getByPlaceholderText('Enter name'))!.toBeInTheDocument()
      expect(screen.getByPlaceholderText('Enter bio'))!.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Submit' }))!.toBeInTheDocument()
      expect(screen.getByText(UNSUPPORTED_TAG_ARTICLE_RE))!.toBeInTheDocument()
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
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { })
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

        expect(screen.getByRole('button', { name: 'Submit' }))!.toBeInTheDocument()
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

      const triggerText = await screen.findByText('Paris')
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

  // DatePicker onChange and onClear callbacks should update form state.
  describe('DatePicker interaction', () => {
    it('should update form value when date is picked via onChange', async () => {
      const user = userEvent.setup()
      const node = createRootNode(
        [
          createElementNode('input', { type: 'date', name: 'startDate', value: '' }),
          createElementNode('button', {}, [createTextNode('Submit')]),
        ],
        { dataFormat: 'json' },
      )

      render(<MarkdownForm node={node} />)

      // Click the DatePicker trigger to open the popup
      const trigger = screen.getByTestId('date-picker-trigger')
      await user.click(trigger)

      // Click the "Now" button in the footer to select current date (calls onChange)
      const nowButton = await screen.findByText('time.operation.now')
      await user.click(nowButton)

      // Submit the form
      await user.click(screen.getByRole('button', { name: 'Submit' }))

      await waitFor(() => {
        // onChange was called with a Dayjs object that has .format, so formatDateForOutput is called
        expect(mockFormatDateForOutput).toHaveBeenCalledWith(expect.anything(), false)
        expect(mockOnSend).toHaveBeenCalled()
      })
    })

    it('should clear form value when date is cleared via onClear', async () => {
      const user = userEvent.setup()
      const node = createRootNode(
        [
          createElementNode('input', { type: 'date', name: 'startDate', value: dayjs('2026-01-10') }),
          createElementNode('button', {}, [createTextNode('Submit')]),
        ],
        { dataFormat: 'json' },
      )

      render(<MarkdownForm node={node} />)

      const clearButton = screen.getByRole('button', { name: 'common.operation.clear' })
      await user.click(clearButton)

      await user.click(screen.getByRole('button', { name: 'Submit' }))

      await waitFor(() => {
        // onClear sets value to undefined, which JSON.stringify omits
        expect(mockOnSend).toHaveBeenCalledWith('{}')
      })
    })
  })

  // TimePicker rendering, onChange, and onClear should work correctly.
  describe('TimePicker interaction', () => {
    it('should render TimePicker for time input type', () => {
      const node = createRootNode([
        createElementNode('input', { type: 'time', name: 'meetingTime', value: '09:00' }),
      ])

      render(<MarkdownForm node={node} />)

      // The real TimePicker renders a trigger with a readonly input showing the formatted time
      const timeInput = screen.getByTestId('time-picker-trigger').querySelector('input[readonly]') as HTMLInputElement
      expect(timeInput).not.toBeNull()
      expect(timeInput.value).toBe('09:00 AM')
    })

    it('should update form value when time is picked via onChange', async () => {
      const user = userEvent.setup()
      const node = createRootNode(
        [
          createElementNode('input', { type: 'time', name: 'meetingTime', value: '' }),
          createElementNode('button', {}, [createTextNode('Submit')]),
        ],
      )

      render(<MarkdownForm node={node} />)

      // Click the TimePicker trigger to open the popup
      const trigger = screen.getByTestId('time-picker-trigger')
      await user.click(trigger)

      // Click the "Now" button in the footer to select current time (calls onChange)
      const nowButtons = await screen.findAllByText('time.operation.now')
      await user.click(nowButtons[0]!)

      // Submit the form
      await user.click(screen.getByRole('button', { name: 'Submit' }))

      await waitFor(() => {
        expect(mockOnSend).toHaveBeenCalled()
      })
    })

    it('should clear form value when time is cleared via onClear', async () => {
      const user = userEvent.setup()
      const node = createRootNode(
        [
          createElementNode('input', { type: 'time', name: 'meetingTime', value: '09:00' }),
          createElementNode('button', {}, [createTextNode('Submit')]),
        ],
        { dataFormat: 'json' },
      )

      render(<MarkdownForm node={node} />)

      // The TimePicker's clear icon has role="button" and an aria-label
      const clearButton = screen.getByRole('button', { name: 'common.operation.clear' })
      await user.click(clearButton)

      await user.click(screen.getByRole('button', { name: 'Submit' }))

      await waitFor(() => {
        // onClear sets value to undefined, which JSON.stringify omits
        expect(mockOnSend).toHaveBeenCalledWith('{}')
      })
    })
  })

  // Inputs and textareas with unsafe names should be silently dropped.
  describe('Unsafe name rejection', () => {
    it('should not render input with prototype-poisoning name', () => {
      const node = createRootNode([
        createElementNode('input', { type: 'text', name: '__proto__', placeholder: 'poison' }),
        createElementNode('button', {}, [createTextNode('Submit')]),
      ])

      render(<MarkdownForm node={node} />)

      expect(screen.queryByPlaceholderText('poison')).not.toBeInTheDocument()
    })

    it('should not render textarea with prototype-poisoning name', () => {
      const node = createRootNode([
        createElementNode('textarea', { name: 'constructor', placeholder: 'poison' }),
        createElementNode('button', {}, [createTextNode('Submit')]),
      ])

      render(<MarkdownForm node={node} />)

      expect(screen.queryByPlaceholderText('poison')).not.toBeInTheDocument()
    })

    it('should not render input when name exceeds 128 characters', () => {
      const longName = 'a'.repeat(129)
      const node = createRootNode([
        createElementNode('input', { type: 'text', name: longName, placeholder: 'long-name' }),
      ])

      render(<MarkdownForm node={node} />)

      expect(screen.queryByPlaceholderText('long-name')).not.toBeInTheDocument()
    })

    it('should not render input when name starts with a digit', () => {
      const node = createRootNode([
        createElementNode('input', { type: 'text', name: '1invalid', placeholder: 'bad-name' }),
      ])

      render(<MarkdownForm node={node} />)

      expect(screen.queryByPlaceholderText('bad-name')).not.toBeInTheDocument()
    })

    it('should not include unsafe-named fields in submission output', async () => {
      const user = userEvent.setup()
      const node = createRootNode(
        [
          createElementNode('input', { type: 'text', name: 'valid', value: 'ok' }),
          createElementNode('input', { type: 'text', name: 'prototype', value: 'bad' }),
          createElementNode('button', {}, [createTextNode('Submit')]),
        ],
        { dataFormat: 'json' },
      )

      render(<MarkdownForm node={node} />)

      await user.click(screen.getByRole('button', { name: 'Submit' }))

      await waitFor(() => {
        expect(mockOnSend).toHaveBeenCalledWith('{"valid":"ok"}')
      })
    })
  })

  // Double-click protection: button disables after the first submit.
  describe('Double submit prevention', () => {
    it('should disable submit button after first click', async () => {
      const user = userEvent.setup()
      const node = createRootNode([
        createElementNode('input', { type: 'text', name: 'name', value: 'Alice' }),
        createElementNode('button', {}, [createTextNode('Submit')]),
      ])

      render(<MarkdownForm node={node} />)

      const button = screen.getByRole('button', { name: 'Submit' })
      await user.click(button)

      await waitFor(() => {
        expect(button)!.toBeDisabled()
      })
    })

    it('should call onSend only once on rapid double click', async () => {
      const user = userEvent.setup()
      const node = createRootNode([
        createElementNode('input', { type: 'text', name: 'name', value: 'Alice' }),
        createElementNode('button', {}, [createTextNode('Submit')]),
      ])

      render(<MarkdownForm node={node} />)

      const button = screen.getByRole('button', { name: 'Submit' })
      await user.click(button)
      await user.click(button)

      await waitFor(() => {
        expect(mockOnSend).toHaveBeenCalledTimes(1)
      })
    })
  })

  // onSend errors should reset submitting state so the user can retry.
  describe('Submit error handling', () => {
    it('should reset isSubmitting when onSend throws', async () => {
      const user = userEvent.setup()
      mockOnSend.mockImplementation(() => {
        throw new Error('send failed')
      })

      const node = createRootNode([
        createElementNode('input', { type: 'text', name: 'name', value: 'Alice' }),
        createElementNode('button', {}, [createTextNode('Submit')]),
      ])

      render(<MarkdownForm node={node} />)

      const button = screen.getByRole('button', { name: 'Submit' })
      await user.click(button)

      await waitFor(() => {
        expect(button).not.toBeDisabled()
      })
    })
  })

  // Button variant and size props should only apply whitelisted values.
  describe('Button variant and size', () => {
    it('should render button with valid variant and size', () => {
      const node = createRootNode([
        createElementNode('button', { dataVariant: 'primary', dataSize: 'large' }, [createTextNode('Go')]),
      ])

      render(<MarkdownForm node={node} />)

      const button = screen.getByRole('button', { name: 'Go' })
      expect(button)!.toBeInTheDocument()
    })

    it('should ignore invalid variant and size values', () => {
      const node = createRootNode([
        createElementNode('button', { dataVariant: 'danger', dataSize: 'xl' }, [createTextNode('Go')]),
      ])

      render(<MarkdownForm node={node} />)

      expect(screen.getByRole('button', { name: 'Go' }))!.toBeInTheDocument()
    })
  })

  // Standard input types (password, email, number) use the generic Input branch.
  describe('Standard input types', () => {
    it('should render password input with masked value', () => {
      const node = createRootNode([
        createElementNode('input', { type: 'password', name: 'secret', placeholder: 'Password' }),
      ])

      render(<MarkdownForm node={node} />)

      const input = screen.getByPlaceholderText('Password')
      expect(input)!.toHaveAttribute('type', 'password')
    })

    it('should render email input', () => {
      const node = createRootNode([
        createElementNode('input', { type: 'email', name: 'email', placeholder: 'Email' }),
      ])

      render(<MarkdownForm node={node} />)

      expect(screen.getByPlaceholderText('Email'))!.toHaveAttribute('type', 'email')
    })

    it('should render number input', () => {
      const node = createRootNode([
        createElementNode('input', { type: 'number', name: 'age', placeholder: 'Age' }),
      ])

      render(<MarkdownForm node={node} />)

      expect(screen.getByPlaceholderText('Age'))!.toHaveAttribute('type', 'number')
    })

    it('should submit typed value from password input', async () => {
      const user = userEvent.setup()
      const node = createRootNode(
        [
          createElementNode('input', { type: 'password', name: 'secret', placeholder: 'Password' }),
          createElementNode('button', {}, [createTextNode('Submit')]),
        ],
        { dataFormat: 'json' },
      )

      render(<MarkdownForm node={node} />)

      await user.type(screen.getByPlaceholderText('Password'), 'mypass')
      await user.click(screen.getByRole('button', { name: 'Submit' }))

      await waitFor(() => {
        expect(mockOnSend).toHaveBeenCalledWith('{"secret":"mypass"}')
      })
    })
  })

  // Inputs whose type is not in SUPPORTED_TYPES_SET should not render.
  describe('Unsupported input type', () => {
    it('should not render input with unsupported type like range', () => {
      const node = createRootNode([
        createElementNode('input', { type: 'range', name: 'slider' }),
      ])

      render(<MarkdownForm node={node} />)

      expect(screen.queryByRole('slider')).not.toBeInTheDocument()
      expect(screen.getByText(UNSUPPORTED_TAG_RE))!.toBeInTheDocument()
    })
  })

  // Fallback branches for edge cases in tag rendering.
  describe('Fallback branches', () => {
    it('should render label with empty text when children array is empty', () => {
      const node = createRootNode([
        createElementNode('label', { for: 'field' }, []),
      ])

      render(<MarkdownForm node={node} />)

      const label = screen.getByTestId('label-field')
      expect(label).not.toBeNull()
      expect(label?.textContent).toBe('')
    })

    it('should render checkbox without tip text when dataTip is missing', () => {
      const node = createRootNode([
        createElementNode('input', { type: 'checkbox', name: 'agree', value: false }),
      ])

      render(<MarkdownForm node={node} />)

      expect(screen.getByTestId('checkbox-agree'))!.toBeInTheDocument()
    })

    it('should render select with no options when dataOptions is missing', () => {
      const node = createRootNode([
        createElementNode('input', { type: 'select', name: 'color', value: '' }),
      ])

      render(<MarkdownForm node={node} />)

      // Select renders with empty items list
      // Select renders with empty items list
      expect(screen.getByTestId('markdown-form'))!.toBeInTheDocument()
    })

    it('should render button with empty text when children array is empty', () => {
      const node = createRootNode([
        createElementNode('button', {}, []),
      ])

      render(<MarkdownForm node={node} />)

      const button = screen.getByRole('button')
      expect(button.textContent).toBe('')
    })
  })
})
