import { formOptions } from '@tanstack/react-form'

export const demoFormOpts = formOptions({
  defaultValues: {
    name: '',
    surname: '',
    isAcceptingTerms: false,
    contact: {
      email: '',
      phone: '',
      preferredContactMethod: 'email',
    },
  },
})
