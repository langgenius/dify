import { demoFormOpts } from './shared-options'

describe('demoFormOpts', () => {
  it('should provide expected default values', () => {
    expect(demoFormOpts.defaultValues).toEqual({
      name: '',
      surname: '',
      isAcceptingTerms: false,
      contact: {
        email: '',
        phone: '',
        preferredContactMethod: 'email',
      },
    })
  })
})
