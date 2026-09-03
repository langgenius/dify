'use client'

import type { FormEvent } from 'react'
import type { DocumentMetadataField, DocumentMetadataType } from './editor-model'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Input } from '@langgenius/dify-ui/input'
import { useId, useMemo, useState } from 'react'
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
  const { t } = useTranslation('knowledgeSpace')
  const { t: tCommon } = useTranslation('common')
  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [type, setType] = useState<DocumentMetadataType>('string')
  const nameErrorId = useId()
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
    if (nameError) return
    try {
      if (await onCreate(name.trim(), type)) close()
    } catch {
      // The workflow owner reports the error. Keep the form open so the user can retry.
    }
  }

  return (
    <form
      className="px-3 pt-3.5 pb-4"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        void create()
      }}
    >
      <button
        type="button"
        className="relative -left-1 mb-1 flex cursor-pointer items-center gap-1 border-0 bg-transparent px-0 py-1 text-text-accent"
        onClick={close}
      >
        <span aria-hidden className="i-ri-arrow-left-line size-4" />
        <span className="system-xs-semibold-uppercase">
          {t(($) => $['metadata.createMetadata.back'], { ns: 'dataset' })}
        </span>
      </button>
      <h3 className="mb-1 flex h-6 items-center system-xl-semibold text-text-primary">
        {t(($) => $['metadata.createMetadata.title'], { ns: 'dataset' })}
      </h3>
      <div className="mt-2 space-y-3">
        <fieldset>
          <legend className="py-1 system-sm-semibold text-text-secondary">
            {t(($) => $['metadata.createMetadata.type'], { ns: 'dataset' })}
          </legend>
          <div className="mt-1 grid grid-cols-3 gap-2">
            {metadataTypes.map((candidate) => (
              <button
                key={candidate}
                type="button"
                aria-pressed={type === candidate}
                className={cn(
                  'h-8 cursor-pointer rounded-md border px-2 system-sm-regular text-text-secondary capitalize focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden',
                  type === candidate
                    ? 'border-[1.5px] border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg system-sm-medium shadow-xs'
                    : 'border-components-option-card-option-border bg-components-option-card-option-bg hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover hover:shadow-xs',
                )}
                onClick={() => setType(candidate)}
              >
                {candidate}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="block">
          <span className="block py-1 system-sm-semibold text-text-secondary">
            {t(($) => $['metadata.createMetadata.name'], { ns: 'dataset' })}
          </span>
          <div className="mt-1">
            <Input
              aria-label={t(($) => $['metadata.createMetadata.name'], { ns: 'dataset' })}
              aria-describedby={nameTouched && nameError ? nameErrorId : undefined}
              aria-invalid={nameTouched && Boolean(nameError) ? true : undefined}
              disabled={pending}
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
          </div>
          {nameTouched && nameError && (
            <span
              id={nameErrorId}
              role="alert"
              className="mt-1 block system-xs-regular text-text-destructive"
            >
              {nameError}
            </span>
          )}
        </label>
      </div>
      <div className="mt-4 flex justify-end">
        <Button className="mr-2" disabled={pending} onClick={close}>
          {tCommon(($) => $['operation.cancel'])}
        </Button>
        <Button disabled={Boolean(nameError)} loading={pending} type="submit" variant="primary">
          {tCommon(($) => $['operation.save'])}
        </Button>
      </div>
    </form>
  )
}
