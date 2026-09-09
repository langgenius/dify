import type { ContactsManagementRepository } from '../repository'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { consoleClient } from '@/service/client'
import { createContactsMockRepository } from '../mock/repository'
import { ContactsMockScenario, createContactsMockScenario } from '../mock/scenarios'
import { createContactsApiRepository } from '../repository'

vi.mock('@/service/client', () => ({
  consoleClient: {
    workspaces: {
      current: {
        humanInput: {
          contacts: {
            get: vi.fn(),
            byContactId: { get: vi.fn() },
            external: { post: vi.fn(), byContactId: { patch: vi.fn() } },
            remove: { post: vi.fn() },
          },
        },
      },
    },
  },
}))

function listContacts(repository: ContactsManagementRepository, page = 1) {
  return repository.listContacts({
    deployment: 'ee',
    kind: 'all',
    limit: 20,
    page,
    search: '',
  })
}

describe('contacts mock repository', () => {
  it('returns generic contacts with backend pagination and timestamp fields', async () => {
    const repository = createContactsMockRepository({
      scenario: createContactsMockScenario(ContactsMockScenario.EeMixed),
    })

    const result = await listContacts(repository)

    expect(result).toMatchObject({ has_more: false, limit: 20, page: 1, total: 3 })
    expect(result.data.map((contact) => contact.type)).toEqual([
      'workspace',
      'platform',
      'external',
    ])
    expect(result.data.every((contact) => Number.isInteger(contact.created_at))).toBe(true)
  })

  it.each([
    ['external@example.com', 'duplicate_external_contact'],
    ['owner@example.com', 'matches_workspace_contact'],
    ['platform@example.com', 'matches_platform_contact'],
  ] as const)('classifies the full lower-case email match for %s', async (email, resultKind) => {
    const repository = createContactsMockRepository({
      scenario: createContactsMockScenario(ContactsMockScenario.EeMixed),
    })

    await expect(
      repository.createExternalContact({
        displayName: 'Conflict',
        email: email.toUpperCase(),
      }),
    ).resolves.toMatchObject({ kind: resultKind })
  })

  it('removes CE workspace contacts and converts retained EE contacts with a stable id', async () => {
    const ceRepository = createContactsMockRepository({
      scenario: createContactsMockScenario(ContactsMockScenario.CeMixed),
    })
    const eeRepository = createContactsMockRepository({
      scenario: createContactsMockScenario(ContactsMockScenario.EeMixed),
    })

    await expect(
      ceRepository.removeMember({ keepAsPlatformContact: false, memberId: 'member-owner' }),
    ).resolves.toMatchObject({ contactOutcome: 'removed', kind: 'removed' })
    expect((await listContacts(ceRepository)).data.map((contact) => contact.id)).not.toContain(
      'contact-owner',
    )

    await expect(
      eeRepository.removeMember({ keepAsPlatformContact: true, memberId: 'member-owner' }),
    ).resolves.toMatchObject({
      contactId: 'contact-owner',
      contactOutcome: 'converted_to_platform',
      kind: 'removed',
    })
    expect((await listContacts(eeRepository)).data).toContainEqual(
      expect.objectContaining({ id: 'contact-owner', type: 'platform' }),
    )
  })

  it('finds External Contact invite conflicts and upgrades them with a stable id', async () => {
    const repository = createContactsMockRepository({
      scenario: createContactsMockScenario(ContactsMockScenario.EeMixed),
    })

    const conflicts = await repository.findExternalContactsByEmails({
      emails: ['EXTERNAL@example.com', 'owner@example.com', 'missing@example.com'],
    })

    expect(conflicts).toEqual([
      expect.objectContaining({
        email: 'external@example.com',
        id: 'contact-external',
        name: 'Courtney Henry',
      }),
    ])

    await expect(
      repository.upgradeExternalContactsToWorkspace({
        contactIds: conflicts.map((contact) => contact.id),
      }),
    ).resolves.toEqual({ contactIds: ['contact-external'], kind: 'upgraded' })
    expect((await listContacts(repository)).data).toContainEqual(
      expect.objectContaining({
        email: 'external@example.com',
        id: 'contact-external',
        name: 'Courtney Henry',
        type: 'workspace',
      }),
    )
  })

  it('excludes Workspace and Platform contacts while retaining External conflicts', async () => {
    const repository = createContactsMockRepository({
      scenario: createContactsMockScenario(ContactsMockScenario.EeMixed),
    })

    const result = await repository.listAvailablePlatformContacts({
      limit: 20,
      page: 1,
      search: '',
    })

    expect(result).toMatchObject({ has_more: false, limit: 20, page: 1, total: 3 })
    expect(result.data.map((contact) => contact.email)).toEqual([
      'ada@example.com',
      'grace@example.com',
      'external@example.com',
    ])
  })

  it('requires confirmation before upgrading an External Contact to Platform with a stable id', async () => {
    const repository = createContactsMockRepository({
      scenario: createContactsMockScenario(ContactsMockScenario.EeMixed),
    })

    await expect(
      repository.listAvailablePlatformContacts({ limit: 20, page: 1, search: '' }),
    ).resolves.toEqual(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ id: 'available-platform-external' }),
        ]),
      }),
    )
    await expect(
      repository.addPlatformContacts({
        contactIds: ['available-platform-ada', 'available-platform-external'],
        upgradeExternalContacts: false,
      }),
    ).resolves.toEqual({
      conflicts: [
        {
          contactId: 'contact-external',
          email: 'external@example.com',
          platformContactId: 'available-platform-external',
        },
      ],
      kind: 'requires_external_contact_upgrade',
    })
    expect((await listContacts(repository)).data).toContainEqual(
      expect.objectContaining({ id: 'contact-external', type: 'external' }),
    )
    expect((await listContacts(repository)).data).not.toContainEqual(
      expect.objectContaining({ id: 'available-platform-ada' }),
    )

    await expect(
      repository.addPlatformContacts({
        contactIds: ['available-platform-ada', 'available-platform-external'],
        upgradeExternalContacts: true,
      }),
    ).resolves.toEqual({
      contactIds: ['available-platform-ada', 'contact-external'],
      kind: 'added',
    })
    expect((await listContacts(repository)).data).toContainEqual(
      expect.objectContaining({
        email: 'external@example.com',
        id: 'contact-external',
        name: 'Courtney Henry',
        type: 'platform',
      }),
    )
    expect((await listContacts(repository)).data).not.toContainEqual(
      expect.objectContaining({ id: 'available-platform-external' }),
    )
  })

  it('removes only Platform and External contacts', async () => {
    const repository = createContactsMockRepository({
      scenario: createContactsMockScenario(ContactsMockScenario.EeMixed),
    })

    await expect(
      repository.removeContacts({
        contactIds: ['contact-owner', 'contact-platform', 'contact-external'],
      }),
    ).resolves.toEqual({
      kind: 'removed',
      removedContactIds: ['contact-platform', 'contact-external'],
    })
    expect((await listContacts(repository)).data).toEqual([
      expect.objectContaining({ id: 'contact-owner', type: 'workspace' }),
    ])
  })

  it('uses page metadata and fails only the requested next page', async () => {
    const paginatedRepository = createContactsMockRepository({
      scenario: createContactsMockScenario(ContactsMockScenario.Paginated),
    })
    const firstPage = await listContacts(paginatedRepository)
    const secondPage = await listContacts(paginatedRepository, 2)

    expect(firstPage).toMatchObject({ has_more: true, limit: 20, page: 1, total: 23 })
    expect(firstPage.data).toHaveLength(20)
    expect(secondPage).toMatchObject({ has_more: false, limit: 20, page: 2, total: 23 })
    expect(secondPage.data).toHaveLength(3)

    const failingRepository = createContactsMockRepository({
      scenario: createContactsMockScenario(ContactsMockScenario.NextPageFailure),
    })
    await expect(listContacts(failingRepository, 2)).rejects.toThrow('contacts_next_page_failed')
  })
})

describe('contacts API repository', () => {
  const contacts = consoleClient.workspaces.current.humanInput.contacts
  const externalContact = {
    avatar_url: '',
    created_at: 1_778_000_000,
    id: 'contact-api-external',
    name: 'API Partner',
    type: 'external' as const,
  }

  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('maps directory filters and pagination to the generated endpoint and preserves server metadata', async () => {
    vi.mocked(contacts.get).mockResolvedValue({
      data: [externalContact],
      limit: 2,
      page: 2,
      total: 3,
    })
    const repository = createContactsApiRepository()

    const result = await repository.listContacts({
      deployment: 'ee',
      kind: 'external',
      limit: 2,
      page: 2,
      search: 'Partner',
    })

    expect(vi.mocked(contacts.get).mock.calls[0]?.[0]).toEqual({
      query: { group: 'external', keyword: 'Partner', limit: 2, page: 2 },
    })
    expect(result).toEqual({
      data: [{ ...externalContact, avatar_url: '', email: null, im_bindings: [] }],
      has_more: false,
      limit: 2,
      page: 2,
      total: 3,
    })
  })

  it('derives another page from total and omits an all-types filter from the API query', async () => {
    vi.mocked(contacts.get).mockResolvedValue({
      data: [externalContact],
      limit: 1,
      page: 1,
      total: 2,
    })
    const repository = createContactsApiRepository()

    const result = await repository.listContacts({
      deployment: 'ce',
      kind: 'all',
      limit: 1,
      page: 1,
      search: '',
    })

    expect(result.has_more).toBe(true)
    expect(vi.mocked(contacts.get).mock.calls[0]?.[0].query?.group).toBeUndefined()
  })

  it('fetches details independently and distinguishes not-found from an unavailable API', async () => {
    const repository = createContactsApiRepository()
    vi.mocked(contacts.byContactId.get).mockResolvedValueOnce({ contact: externalContact })

    await expect(repository.getContact(externalContact.id)).resolves.toEqual({
      ...externalContact,
      avatar_url: '',
      email: null,
      im_bindings: [],
    })
    expect(vi.mocked(contacts.byContactId.get).mock.calls[0]?.[0]).toEqual({
      params: { contact_id: externalContact.id },
    })
    expect(contacts.get).not.toHaveBeenCalled()

    vi.mocked(contacts.byContactId.get).mockRejectedValueOnce(
      Object.assign(new Error('Not found'), { status: 404 }),
    )
    await expect(repository.getContact('deleted-contact')).resolves.toBeNull()
    const unavailable = Object.assign(new Error('API unavailable'), { status: 503 })
    vi.mocked(contacts.byContactId.get).mockRejectedValueOnce(unavailable)
    await expect(repository.getContact(externalContact.id)).rejects.toBe(unavailable)
  })

  it('sends backend field names for creation and editing and returns the server contact ID', async () => {
    const repository = createContactsApiRepository()
    vi.mocked(contacts.external.post).mockResolvedValueOnce({ contact: externalContact })
    vi.mocked(contacts.external.byContactId.patch).mockResolvedValueOnce({
      contact: externalContact,
    })
    const command = { displayName: 'API Partner', email: 'partner@example.com' }

    await expect(repository.createExternalContact(command)).resolves.toEqual({
      contactId: externalContact.id,
      kind: 'created',
    })
    expect(vi.mocked(contacts.external.post).mock.calls[0]?.[0]).toEqual({
      body: { name: command.displayName, email: command.email },
    })
    await expect(
      repository.updateExternalContact({ ...command, contactId: externalContact.id }),
    ).resolves.toEqual({
      contactId: externalContact.id,
      kind: 'updated',
    })
    expect(vi.mocked(contacts.external.byContactId.patch).mock.calls[0]?.[0]).toEqual({
      body: { name: command.displayName, email: command.email },
      params: { contact_id: externalContact.id },
    })
  })

  it('returns only IDs confirmed by the server after a batch removal', async () => {
    const repository = createContactsApiRepository()
    vi.mocked(contacts.remove.post).mockResolvedValueOnce({
      removed_contact_ids: [externalContact.id],
    })

    await expect(
      repository.removeContacts({ contactIds: [externalContact.id, 'other-contact'] }),
    ).resolves.toEqual({
      kind: 'removed',
      removedContactIds: [externalContact.id],
    })
    expect(vi.mocked(contacts.remove.post).mock.calls[0]?.[0]).toEqual({
      body: { contact_ids: [externalContact.id, 'other-contact'] },
    })
  })

  it('does not replace failed API reads or writes with mock data or successful mutations', async () => {
    const repository = createContactsApiRepository()
    const failure = Object.assign(new Error('API unavailable'), { status: 503 })
    vi.mocked(contacts.get).mockRejectedValueOnce(failure)
    vi.mocked(contacts.external.post).mockRejectedValueOnce(failure)
    vi.mocked(contacts.external.byContactId.patch).mockRejectedValueOnce(failure)
    vi.mocked(contacts.remove.post).mockRejectedValueOnce(failure)

    await expect(listContacts(repository)).rejects.toBe(failure)
    await expect(
      repository.createExternalContact({ displayName: 'Partner', email: 'partner@example.com' }),
    ).resolves.toEqual({ kind: 'failed' })
    await expect(
      repository.updateExternalContact({
        contactId: externalContact.id,
        displayName: 'Partner',
        email: 'partner@example.com',
      }),
    ).resolves.toEqual({ kind: 'failed' })
    await expect(repository.removeContacts({ contactIds: [externalContact.id] })).resolves.toEqual({
      kind: 'failed',
    })
  })

  it('shows the conflict outcome without inventing an ID absent from a 409 response', async () => {
    const repository = createContactsApiRepository()
    const conflict = Object.assign(new Error('Contact already exists'), { status: 409 })
    vi.mocked(contacts.external.post).mockRejectedValueOnce(conflict)
    vi.mocked(contacts.external.byContactId.patch).mockRejectedValueOnce(conflict)
    const command = { displayName: 'Partner', email: 'partner@example.com' }

    await expect(repository.createExternalContact(command)).resolves.toEqual({
      kind: 'duplicate_external_contact',
    })
    await expect(
      repository.updateExternalContact({ ...command, contactId: externalContact.id }),
    ).resolves.toEqual({ kind: 'duplicate_external_contact' })
  })
})
