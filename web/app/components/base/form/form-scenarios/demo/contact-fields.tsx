import { withForm } from '../..'
import { demoFormOpts } from './shared-options'
import { ContactMethods } from './types'

const ContactFields = withForm({
  ...demoFormOpts,
  render: ({ form }) => {
    return (
      <div className="my-2">
        <h3 className="title-lg-bold text-text-primary">Contacts</h3>
        <div className="flex flex-col gap-4">
          <form.AppField
            name="contact.email"
            children={field => <field.TextField label="Email" />}
          />
          <form.AppField
            name="contact.phone"
            children={field => <field.TextField label="Phone" />}
          />
          <form.AppField
            name="contact.preferredContactMethod"
            children={field => (
              <field.SelectField
                label="Preferred Contact Method"
                options={ContactMethods}
              />
            )}
          />
        </div>
      </div>
    )
  },
})

export default ContactFields
