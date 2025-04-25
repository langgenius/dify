import { z } from 'zod'

const ContactMethod = z.union([
  z.literal('email'),
  z.literal('phone'),
  z.literal('whatsapp'),
  z.literal('sms'),
])

export const ContactMethods = ContactMethod.options.map(({ value }) => ({
  value,
  label: value.charAt(0).toUpperCase() + value.slice(1),
}))

export const UserSchema = z.object({
  name: z
    .string()
    .regex(/^[A-Z]/, 'Name must start with a capital letter')
    .min(3, 'Name must be at least 3 characters long'),
  surname: z
    .string()
    .min(3, 'Surname must be at least 3 characters long')
    .regex(/^[A-Z]/, 'Surname must start with a capital letter'),
  isAcceptingTerms: z.boolean().refine(val => val, {
    message: 'You must accept the terms and conditions',
  }),
  contact: z.object({
    email: z.string().email('Invalid email address'),
    phone: z.string().optional(),
    preferredContactMethod: ContactMethod,
  }),
})

export type User = z.infer<typeof UserSchema>
