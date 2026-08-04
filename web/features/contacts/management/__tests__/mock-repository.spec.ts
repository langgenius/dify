import type { ContactsManagementRepository } from '../repository'
import { describe, expect, it } from 'vitest'
import { createContactsMockRepository } from '../mock/repository'
import { ContactsMockScenario, createContactsMockScenario } from '../mock/scenarios'

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
