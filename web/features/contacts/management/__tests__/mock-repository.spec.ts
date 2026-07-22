import { describe, expect, it } from 'vitest'
import { createContactsMockRepository, mergeContactPages } from '../mock/repository'
import { ContactsMockScenario, createContactsMockScenario } from '../mock/scenarios'

describe('contacts mock repository', () => {
  it('keeps the discriminated contact kinds and list/detail state consistent', async () => {
    const scenario = createContactsMockScenario(ContactsMockScenario.EeMixed)
    const repository = createContactsMockRepository({ scenario })

    const page = await repository.listContacts({
      cursor: null,
      deployment: 'ee',
      kind: 'all',
      pageSize: 20,
      search: '',
    })

    expect(page.items.map((contact) => contact.kind)).toEqual(['workspace', 'platform', 'external'])
    const platformContact = page.items[1]
    expect(platformContact).toBeDefined()
    await expect(repository.getContact(platformContact!.id)).resolves.toEqual(platformContact)
  })

  it('deduplicates contacts when incremental pages overlap', () => {
    const scenario = createContactsMockScenario(ContactsMockScenario.EeMixed)
    const [first, second, third] = scenario.contacts
    expect(first && second && third).toBeDefined()

    expect(
      mergeContactPages([
        [first!, second!],
        [second!, third!],
      ]),
    ).toEqual([first, second, third])
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
        workspaceId: 'workspace-1',
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
    await expect(ceRepository.getContact('contact-owner')).resolves.toBeNull()

    await expect(
      eeRepository.removeMember({ keepAsPlatformContact: true, memberId: 'member-owner' }),
    ).resolves.toMatchObject({
      contactId: 'contact-owner',
      contactOutcome: 'converted_to_platform',
      kind: 'removed',
    })
    await expect(eeRepository.getContact('contact-owner')).resolves.toMatchObject({
      id: 'contact-owner',
      kind: 'platform',
    })
  })

  it('excludes existing identities from available Platform contacts', async () => {
    const repository = createContactsMockRepository({
      scenario: createContactsMockScenario(ContactsMockScenario.EeMixed),
    })

    const result = await repository.listAvailablePlatformContacts({
      cursor: null,
      pageSize: 20,
      search: '',
    })

    expect(result.items.map((contact) => contact.email)).toEqual([
      'ada@example.com',
      'grace@example.com',
    ])
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
    await expect(repository.getContact('contact-owner')).resolves.toMatchObject({
      kind: 'workspace',
    })
    await expect(repository.getContact('contact-platform')).resolves.toBeNull()
    await expect(repository.getContact('contact-external')).resolves.toBeNull()
  })

  it('uses stable cursors and fails only the requested next page', async () => {
    const repository = createContactsMockRepository({
      scenario: createContactsMockScenario(ContactsMockScenario.NextPageFailure),
    })
    const firstPage = await repository.listContacts({
      cursor: null,
      deployment: 'ee',
      kind: 'all',
      pageSize: 20,
      search: '',
    })

    expect(firstPage.items).toHaveLength(20)
    expect(firstPage.nextCursor).toBe('20')
    await expect(
      repository.listContacts({
        cursor: firstPage.nextCursor,
        deployment: 'ee',
        kind: 'all',
        pageSize: 20,
        search: '',
      }),
    ).rejects.toThrow('contacts_next_page_failed')
  })
})
