import { useStore } from '@tanstack/react-form'
import { useAppForm } from '../..'
import ContactFields from './contact-fields'
import { demoFormOpts } from './shared-options'
import { UserSchema } from './types'

const DemoForm = () => {
  const form = useAppForm({
    ...demoFormOpts,
    validators: {
      onSubmit: ({ value }) => {
        // Validate the entire form
        const result = UserSchema.safeParse(value)
        if (!result.success) {
          const issues = result.error.issues
          console.log('Validation errors:', issues)
          return issues[0].message
        }
        return undefined
      },
    },
    onSubmit: ({ value }) => {
      console.log('Form submitted:', value)
    },
  })

  const name = useStore(form.store, state => state.values.name)

  return (
    <form
      className="flex w-[400px] flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation()
        form.handleSubmit()
      }}
    >
      <form.AppField
        name="name"
        children={field => (
          <field.TextField label="Name" />
        )}
      />
      <form.AppField
        name="surname"
        children={field => (
          <field.TextField label="Surname" />
        )}
      />
      <form.AppField
        name="isAcceptingTerms"
        children={field => (
          <field.CheckboxField label="I accept the terms and conditions." />
        )}
      />
      {
        !!name && (
          <ContactFields form={form} />
        )
      }
      <form.AppForm>
        <form.Actions />
      </form.AppForm>
    </form>
  )
}

export default DemoForm
