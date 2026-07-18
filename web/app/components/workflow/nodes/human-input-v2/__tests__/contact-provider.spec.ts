import { mockContactRecipientOptionProvider } from '../contact-provider'

describe('mock Contact recipient option provider', () => {
  it('provides deterministic case-insensitive search and id resolution', async () => {
    await expect(mockContactRecipientOptionProvider.search('EVAN')).resolves.toEqual([
      expect.objectContaining({ id: 'contact-evan', name: 'Evan Zhang' }),
    ])
    await expect(
      mockContactRecipientOptionProvider.resolve(['missing', 'contact-amanda']),
    ).resolves.toEqual([expect.objectContaining({ id: 'contact-amanda' })])
  })

  it('returns defensive copies', async () => {
    const first = await mockContactRecipientOptionProvider.search('')
    first[0]!.name = 'Changed'
    const second = await mockContactRecipientOptionProvider.search('')

    expect(second[0]!.name).toBe('Evan Zhang')
  })
})
