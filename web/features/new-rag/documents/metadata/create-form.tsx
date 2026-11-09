'use client'

import type { SubmitEvent } from 'react'
import type { DocumentMetadataField, DocumentMetadataType } from './editor-model'
import { Button } from '@langgenius/dify-ui/button'
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Fieldset, FieldsetLegend } from '@langgenius/dify-ui/fieldset'
import { Input } from '@langgenius/dify-ui/input'
import { RadioGroup, RadioItem } from '@langgenius/dify-ui/radio-group'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { documentMetadataNameError } from './editor-model'

const metadataTypes: readonly DocumentMetadataType[] = ['string', 'number', 'time']

export function DocumentMetadataCreateForm({
  allowedExistingName,
  fields,
  pending,
  onClose,
  onCreate,
}: {
  allowedExistingName?: string
  fields: readonly DocumentMetadataField[]
  pending: boolean
  onClose: () => void
  onCreate: (name: string, type: DocumentMetadataType) => Promise<boolean>
}) {
  const { t } = useTranslation(['knowledgeSpace', 'dataset'])
  const { t: tCommon } = useTranslation(['common'])
  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [type, setType] = useState<DocumentMetadataType>('string')
  const nameInputRef = useRef<HTMLInputElement>(null)
  const nameErrorKind = useMemo(
    () => documentMetadataNameError(name, fields, allowedExistingName),
    [allowedExistingName, fields, name],
  )
  const nameError = useMemo(() => {
    if (!nameErrorKind) return undefined
    return t(($) => $[`metadata.checkName.${nameErrorKind}`], { max: 255, ns: 'dataset' })
  }, [nameErrorKind, t])

  const close = () => {
    setName('')
    setNameTouched(false)
    setType('string')
    onClose()
  }

  const create = async () => {
    if (pending) return
    setNameTouched(true)
    if (nameError) {
      nameInputRef.current?.focus()
      return
    }
    try {
      if (await onCreate(name.trim(), type)) close()
    } catch {
      // The workflow owner reports the error. Keep the form open so the user can retry.
    }
  }

  return (
    <form
      className="px-3 pt-3.5 pb-4"
      onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
        event.preventDefault()
        // The form renders in a portal; keep its submit from reaching an enclosing React form.
        event.stopPropagation()
        void create()
      }}
    >
      <Button variant="ghost-accent" size="small" className="-ms-2 mb-1" onClick={close}>
        <span aria-hidden className="i-ri-arrow-left-line size-4" />
        <span className="system-xs-semibold-uppercase">
          {t(($) => $['metadata.createMetadata.back'], { ns: 'dataset' })}
        </span>
      </Button>
      <h3 className="mb-1 flex h-6 items-center system-xl-semibold text-text-primary">
        {t(($) => $['metadata.createMetadata.title'], { ns: 'dataset' })}
      </h3>
      <div className="mt-2 space-y-3">
        <Field name="type" disabled={pending}>
          <Fieldset
            render={
              <RadioGroup<DocumentMetadataType>
                className="block"
                value={type}
                onValueChange={setType}
              />
            }
          >
            <FieldsetLegend className="system-sm-semibold">
              {t(($) => $['metadata.createMetadata.type'], { ns: 'dataset' })}
            </FieldsetLegend>
            <div className="grid grid-cols-3 gap-2">
              {metadataTypes.map((candidate) => (
                <RadioItem<DocumentMetadataType>
                  key={candidate}
                  value={candidate}
                  className="flex h-8 cursor-pointer items-center justify-center rounded-md border border-components-option-card-option-border bg-components-option-card-option-bg px-2 system-sm-regular text-text-secondary outline-hidden hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover hover:shadow-xs focus-visible:ring-2 focus-visible:ring-state-accent-solid data-checked:border-[1.5px] data-checked:border-components-option-card-option-selected-border data-checked:bg-components-option-card-option-selected-bg data-checked:system-sm-medium data-checked:shadow-xs data-disabled:cursor-not-allowed"
                >
                  {t(($) => $[`metadata.type.${candidate}`], { ns: 'dataset' })}
                </RadioItem>
              ))}
            </div>
          </Fieldset>
        </Field>
        <Field name="name" disabled={pending} invalid={nameTouched && Boolean(nameError)}>
          <FieldLabel className="py-1 system-sm-semibold text-text-secondary">
            {t(($) => $['metadata.createMetadata.name'], { ns: 'dataset' })}
          </FieldLabel>
          <Input
            ref={nameInputRef}
            // oxlint-disable-next-line jsx-a11y/no-autofocus -- The form replaces the focused picker view or opens from an explicit create action.
            autoFocus
            autoComplete="off"
            onBlur={() => setNameTouched(true)}
            onChange={(event) => {
              setName(event.target.value)
              setNameTouched(true)
            }}
            placeholder={t(($) => $['metadata.createMetadata.namePlaceholder'], {
              ns: 'dataset',
            })}
            value={name}
          />
          <div className="min-h-5">
            {nameTouched && nameError && <FieldError match>{nameError}</FieldError>}
          </div>
        </Field>
      </div>
      <div className="mt-4 flex justify-end">
        <Button className="me-2" disabled={pending} onClick={close}>
          {tCommon(($) => $['operation.cancel'])}
        </Button>
        <Button loading={pending} type="submit" variant="primary">
          {tCommon(($) => $['operation.save'])}
        </Button>
      </div>
    </form>
  )
}
