import type { Meta, StoryObj } from '@storybook/nextjs'
import { useMemo, useState } from 'react'
import { useStore } from '@tanstack/react-form'
import ContactFields from './form-scenarios/demo/contact-fields'
import { demoFormOpts } from './form-scenarios/demo/shared-options'
import { ContactMethods, UserSchema } from './form-scenarios/demo/types'
import BaseForm from './components/base/base-form'
import type { FormSchema } from './types'
import { FormTypeEnum } from './types'
import { type FormStoryRender, FormStoryWrapper } from '../../../../.storybook/utils/form-story-wrapper'
import Button from '../button'
import { TransferMethod } from '@/types/app'
import { PreviewMode } from '@/app/components/base/features/types'

const FormStoryHost = () => null

const meta = {
  title: 'Base/Data Entry/AppForm',
  component: FormStoryHost,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Helper utilities built on top of `@tanstack/react-form` that power form rendering across Dify. These stories demonstrate the `useAppForm` hook, field primitives, conditional visibility, and custom actions.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof FormStoryHost>

export default meta
type Story = StoryObj<typeof meta>

type AppFormInstance = Parameters<FormStoryRender>[0]
type ContactFieldsProps = React.ComponentProps<typeof ContactFields>
type ContactFieldsFormApi = ContactFieldsProps['form']

type PlaygroundFormFieldsProps = {
  form: AppFormInstance
  status: string
}

const PlaygroundFormFields = ({ form, status }: PlaygroundFormFieldsProps) => {
  type PlaygroundFormValues = typeof demoFormOpts.defaultValues
  const name = useStore(form.store, state => (state.values as PlaygroundFormValues).name)
  const contactFormApi = form as ContactFieldsFormApi

  return (
    <form
      className="flex w-full max-w-xl flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        form.handleSubmit()
      }}
    >
      <form.AppField
        name="name"
        children={field => (
          <field.TextField
            label="Name"
            placeholder="Start with a capital letter"
          />
        )}
      />
      <form.AppField
        name="surname"
        children={field => (
          <field.TextField
            label="Surname"
            placeholder="Surname must be at least 3 characters"
          />
        )}
      />
      <form.AppField
        name="isAcceptingTerms"
        children={field => (
          <field.CheckboxField
            label="I accept the terms and conditions"
          />
        )}
      />

      {!!name && <ContactFields form={contactFormApi} />}

      <form.AppForm>
        <form.Actions />
      </form.AppForm>

      <p className="text-xs text-text-tertiary">{status}</p>
    </form>
  )
}

const FormPlayground = () => {
  const [status, setStatus] = useState('Fill in the form and submit to see results.')

  return (
    <FormStoryWrapper
      title="Customer onboarding form"
      subtitle="Validates with zod and conditionally reveals contact preferences."
      options={{
        ...demoFormOpts,
        validators: {
          onSubmit: ({ value }) => {
            const result = UserSchema.safeParse(value as typeof demoFormOpts.defaultValues)
            if (!result.success)
              return result.error.issues[0].message
            return undefined
          },
        },
        onSubmit: ({ value }) => {
          setStatus('Successfully saved profile.')
        },
      }}
    >
      {form => <PlaygroundFormFields form={form} status={status} />}
    </FormStoryWrapper>
  )
}

const mockFileUploadConfig = {
  enabled: true,
  allowed_file_extensions: ['pdf', 'png'],
  allowed_file_upload_methods: [TransferMethod.local_file, TransferMethod.remote_url],
  number_limits: 3,
  preview_config: {
    mode: PreviewMode.CurrentPage,
    file_type_list: ['pdf', 'png'],
  },
}

const mockFieldDefaults = {
  headline: 'Dify App',
  description: 'Streamline your AI workflows with configurable building blocks.',
  category: 'workbench',
  allowNotifications: true,
  dailyLimit: 40,
  attachment: [],
}

const FieldGallery = () => {
  const selectOptions = useMemo(() => [
    { value: 'workbench', label: 'Workbench' },
    { value: 'playground', label: 'Playground' },
    { value: 'production', label: 'Production' },
  ], [])

  return (
    <FormStoryWrapper
      title="Field gallery"
      subtitle="Preview the most common field primitives exposed through `form.AppField` helpers."
      options={{
        defaultValues: mockFieldDefaults,
      }}
    >
      {form => (
        <form
          className="grid w-full max-w-4xl grid-cols-1 gap-4 lg:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            form.handleSubmit()
          }}
        >
          <form.AppField
            name="headline"
            children={field => (
              <field.TextField
                label="Headline"
                placeholder="Name your experience"
              />
            )}
          />
          <form.AppField
            name="description"
            children={field => (
              <field.TextAreaField
                label="Description"
                placeholder="Describe what this configuration does"
              />
            )}
          />
          <form.AppField
            name="category"
            children={field => (
              <field.SelectField
                label="Category"
                options={selectOptions}
              />
            )}
          />
          <form.AppField
            name="allowNotifications"
            children={field => (
              <field.CheckboxField label="Enable usage notifications" />
            )}
          />
          <form.AppField
            name="dailyLimit"
            children={field => (
              <field.NumberSliderField
                label="Daily session limit"
                description="Control the maximum number of runs per user each day."
                min={10}
                max={100}
              />
            )}
          />
          <form.AppField
            name="attachment"
            children={field => (
              <field.FileUploaderField
                label="Reference materials"
                fileConfig={mockFileUploadConfig}
              />
            )}
          />
          <div className="lg:col-span-2">
            <form.AppForm>
              <form.Actions />
            </form.AppForm>
          </div>
        </form>
      )}
    </FormStoryWrapper>
  )
}

const conditionalSchemas: FormSchema[] = [
  {
    type: FormTypeEnum.select,
    name: 'channel',
    label: 'Preferred channel',
    required: true,
    default: 'email',
    options: ContactMethods,
  },
  {
    type: FormTypeEnum.textInput,
    name: 'contactEmail',
    label: 'Email address',
    required: true,
    placeholder: 'user@example.com',
    show_on: [{ variable: 'channel', value: 'email' }],
  },
  {
    type: FormTypeEnum.textInput,
    name: 'contactPhone',
    label: 'Phone number',
    required: true,
    placeholder: '+1 555 123 4567',
    show_on: [{ variable: 'channel', value: 'phone' }],
  },
  {
    type: FormTypeEnum.boolean,
    name: 'optIn',
    label: 'Opt in to marketing messages',
    required: false,
  },
]

const ConditionalFieldsStory = () => {
  const [values, setValues] = useState<Record<string, unknown>>({
    channel: 'email',
    optIn: false,
  })

  return (
    <div className="flex flex-col gap-6 px-6 md:flex-row md:px-10">
      <div className="flex-1 rounded-xl border border-divider-subtle bg-components-panel-bg p-5 shadow-sm">
        <BaseForm
          formSchemas={conditionalSchemas}
          defaultValues={values}
          formClassName="flex flex-col gap-4"
          onChange={(field, value) => {
            setValues(prev => ({
              ...prev,
              [field]: value,
            }))
          }}
        />
      </div>
      <aside className="w-full max-w-sm rounded-xl border border-divider-subtle bg-components-panel-bg p-4 text-xs text-text-secondary shadow-sm">
        <h3 className="text-sm font-semibold text-text-primary">Live values</h3>
        <p className="mb-2 text-[11px] text-text-tertiary">`show_on` rules hide or reveal inputs without losing track of the form state.</p>
        <pre className="max-h-48 overflow-auto rounded-md bg-background-default-subtle p-3 font-mono text-[11px] leading-tight text-text-primary">
          {JSON.stringify(values, null, 2)}
        </pre>
      </aside>
    </div>
  )
}

const CustomActionsStory = () => {
  return (
    <FormStoryWrapper
      title="Custom footer actions"
      subtitle="Override the default submit button to add reset or secondary operations."
      options={{
        defaultValues: {
          datasetName: 'Support FAQ',
          datasetDescription: 'Knowledge base snippets sourced from Zendesk exports.',
        },
        validators: {
          onChange: ({ value }) => {
            const nextValues = value as { datasetName?: string }
            if (!nextValues.datasetName || nextValues.datasetName.length < 3)
              return 'Dataset name must contain at least 3 characters.'
            return undefined
          },
        },
      }}
    >
      {form => (
        <form
          className="flex w-full max-w-xl flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            form.handleSubmit()
          }}
        >
          <form.AppField
            name="datasetName"
            children={field => (
              <field.TextField
                label="Dataset name"
                placeholder="Support knowledge base"
              />
            )}
          />
          <form.AppField
            name="datasetDescription"
            children={field => (
              <field.TextAreaField
                label="Description"
                placeholder="Add a helpful summary for collaborators"
              />
            )}
          />
          <form.AppForm>
            <form.Actions
              CustomActions={({ form: appForm, isSubmitting, canSubmit }) => (
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => appForm.reset()}
                    disabled={isSubmitting}
                  >
                    Reset
                  </Button>
                  <Button
                    variant="tertiary"
                    onClick={() => {
                      appForm.handleSubmit()
                    }}
                    disabled={!canSubmit}
                    loading={isSubmitting}
                  >
                    Save draft
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => appForm.handleSubmit()}
                    disabled={!canSubmit}
                    loading={isSubmitting}
                  >
                    Publish
                  </Button>
                </div>
              )}
            />
          </form.AppForm>
        </form>
      )}
    </FormStoryWrapper>
  )
}

export const Playground: Story = {
  render: () => <FormPlayground />,
  parameters: {
    docs: {
      source: {
        language: 'tsx',
        code: `
const form = useAppForm({
  ...demoFormOpts,
  validators: {
    onSubmit: ({ value }) => UserSchema.safeParse(value).success ? undefined : 'Validation failed',
  },
  onSubmit: ({ value }) => {
    setStatus(\`Successfully saved profile for \${value.name}\`)
  },
})

return (
  <form onSubmit={handleSubmit}>
    <form.AppField name="name">
      {field => <field.TextField label="Name" placeholder="Start with a capital letter" />}
    </form.AppField>
    <form.AppField name="surname">
      {field => <field.TextField label="Surname" />}
    </form.AppField>
    <form.AppField name="isAcceptingTerms">
      {field => <field.CheckboxField label="I accept the terms and conditions" />}
    </form.AppField>
    {!!form.store.state.values.name && <ContactFields form={form} />}
    <form.AppForm>
      <form.Actions />
    </form.AppForm>
  </form>
)
        `.trim(),
      },
    },
  },
}

export const FieldExplorer: Story = {
  render: () => <FieldGallery />,
  parameters: {
    nextjs: {
      appDirectory: true,
      navigation: {
        pathname: '/apps/demo-app/form',
        params: { appId: 'demo-app' },
      },
    },
    docs: {
      source: {
        language: 'tsx',
        code: `
const form = useAppForm({
  defaultValues: {
    headline: 'Dify App',
    description: 'Streamline your AI workflows',
    category: 'workbench',
    allowNotifications: true,
    dailyLimit: 40,
    attachment: [],
  },
})

return (
  <form className="grid grid-cols-1 gap-4 lg:grid-cols-2" onSubmit={handleSubmit}>
    <form.AppField name="headline">
      {field => <field.TextField label="Headline" />}
    </form.AppField>
    <form.AppField name="description">
      {field => <field.TextAreaField label="Description" />}
    </form.AppField>
    <form.AppField name="category">
      {field => <field.SelectField label="Category" options={selectOptions} />}
    </form.AppField>
    <form.AppField name="allowNotifications">
      {field => <field.CheckboxField label="Enable usage notifications" />}
    </form.AppField>
    <form.AppField name="dailyLimit">
      {field => <field.NumberSliderField label="Daily session limit" min={10} max={100} step={10} />}
    </form.AppField>
    <form.AppField name="attachment">
      {field => <field.FileUploaderField label="Reference materials" fileConfig={mockFileUploadConfig} />}
    </form.AppField>
    <form.AppForm>
      <form.Actions />
    </form.AppForm>
  </form>
)
        `.trim(),
      },
    },
  },
}

export const ConditionalVisibility: Story = {
  render: () => <ConditionalFieldsStory />,
  parameters: {
    docs: {
      description: {
        story: 'Demonstrates schema-driven visibility using `show_on` conditions rendered through the reusable `BaseForm` component.',
      },
      source: {
        language: 'tsx',
        code: `
const conditionalSchemas: FormSchema[] = [
  { type: FormTypeEnum.select, name: 'channel', label: 'Preferred channel', options: ContactMethods },
  { type: FormTypeEnum.textInput, name: 'contactEmail', label: 'Email', show_on: [{ variable: 'channel', value: 'email' }] },
  { type: FormTypeEnum.textInput, name: 'contactPhone', label: 'Phone', show_on: [{ variable: 'channel', value: 'phone' }] },
  { type: FormTypeEnum.boolean, name: 'optIn', label: 'Opt in to marketing messages' },
]

return (
  <BaseForm
    formSchemas={conditionalSchemas}
    defaultValues={{ channel: 'email', optIn: false }}
    formClassName="flex flex-col gap-4"
    onChange={(field, value) => setValues(prev => ({ ...prev, [field]: value }))}
  />
)
        `.trim(),
      },
    },
  },
}

export const CustomActions: Story = {
  render: () => <CustomActionsStory />,
  parameters: {
    docs: {
      description: {
        story: 'Shows how to replace the default submit button with a fully custom footer leveraging contextual form state.',
      },
      source: {
        language: 'tsx',
        code: `
const form = useAppForm({
  defaultValues: {
    datasetName: 'Support FAQ',
    datasetDescription: 'Knowledge base snippets sourced from Zendesk exports.',
  },
  validators: {
    onChange: ({ value }) => value.datasetName?.length >= 3 ? undefined : 'Dataset name must contain at least 3 characters.',
  },
})

return (
  <form onSubmit={handleSubmit} className="flex flex-col gap-4">
    <form.AppField name="datasetName">
      {field => <field.TextField label="Dataset name" />}
    </form.AppField>
    <form.AppField name="datasetDescription">
      {field => <field.TextAreaField label="Description" />}
    </form.AppField>
    <form.AppForm>
      <form.Actions
        CustomActions={({ form: appForm, isSubmitting, canSubmit }) => (
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => appForm.reset()} disabled={isSubmitting}>
              Reset
            </Button>
            <Button variant="tertiary" onClick={() => appForm.handleSubmit()} disabled={!canSubmit} loading={isSubmitting}>
              Save draft
            </Button>
            <Button variant="primary" onClick={() => appForm.handleSubmit()} disabled={!canSubmit} loading={isSubmitting}>
              Publish
            </Button>
          </div>
        )}
      />
    </form.AppForm>
  </form>
)
        `.trim(),
      },
    },
  },
}
