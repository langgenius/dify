export type ContactRecipientOption = {
  id: string
  name: string
  email: string
  avatar?: string
  source: 'workspace' | 'organization' | 'external'
}

export type ContactRecipientOptionProvider = {
  search: (query: string) => Promise<ContactRecipientOption[]>
  resolve: (query: { contact_ids: string[] }) => Promise<ContactRecipientOption[]>
}

const MOCK_CONTACT_OPTIONS: ContactRecipientOption[] = [
  {
    id: 'contact-evan',
    name: 'Evan Zhang',
    email: 'evan@example.com',
    source: 'workspace',
  },
  {
    id: 'contact-amanda',
    name: 'Amanda Lin',
    email: 'amanda@example.com',
    source: 'organization',
  },
  {
    id: 'contact-morgan',
    name: 'Morgan Lee',
    email: 'morgan@external.example',
    source: 'external',
  },
]

const waitForMockTick = () => Promise.resolve()

export const mockContactRecipientOptionProvider: ContactRecipientOptionProvider = {
  async search(query) {
    await waitForMockTick()
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return MOCK_CONTACT_OPTIONS.map((option) => ({ ...option }))
    return MOCK_CONTACT_OPTIONS.filter(
      (option) =>
        option.name.toLowerCase().includes(normalizedQuery) ||
        option.email.toLowerCase().includes(normalizedQuery),
    ).map((option) => ({ ...option }))
  },
  async resolve({ contact_ids }) {
    await waitForMockTick()
    const idSet = new Set(contact_ids)
    return MOCK_CONTACT_OPTIONS.filter((option) => idSet.has(option.id)).map((option) => ({
      ...option,
    }))
  },
}
