import { render, screen } from '@testing-library/react'
import { useAppForm } from '../..'
import ContactFields from './contact-fields'
import { demoFormOpts } from './shared-options'

const ContactFieldsHarness = () => {
  const form = useAppForm({
    ...demoFormOpts,
    onSubmit: () => {},
  })

  return <ContactFields form={form} />
}

describe('ContactFields', () => {
  it('should render contact section fields', () => {
    render(<ContactFieldsHarness />)

    expect(screen.getByRole('heading', { name: /contacts/i })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /email/i })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /phone/i })).toBeInTheDocument()
    expect(screen.getByText(/preferred contact method/i)).toBeInTheDocument()
  })
})
