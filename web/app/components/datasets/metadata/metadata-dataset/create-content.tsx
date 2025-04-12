'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import { DataType } from '../types'
import ModalLikeWrap from '../../../base/modal-like-wrap'
import Field from './field'
import OptionCard from '../../../workflow/nodes/_base/components/option-card'
import Input from '@/app/components/base/input'
import { RiArrowLeftLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { noop } from 'lodash-es'

const i18nPrefix = 'dataset.metadata.createMetadata'

export type Props = {
  onClose?: () => void
  onSave: (data: any) => void
  hasBack?: boolean
  onBack?: () => void
}

const CreateContent: FC<Props> = ({
  onClose = noop,
  hasBack,
  onBack,
  onSave,
}) => {
  const { t } = useTranslation()
  const [type, setType] = useState(DataType.string)

  const handleTypeChange = useCallback((newType: DataType) => {
    return () => setType(newType)
  }, [setType])
  const [name, setName] = useState('')
  const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setName(e.target.value)
  }, [setName])

  const handleSave = useCallback(() => {
    onSave({
      type,
      name,
    })
  }, [onSave, type, name])

  return (
    <ModalLikeWrap
      title={t(`${i18nPrefix}.title`)}
      onClose={onClose}
      onConfirm={handleSave}
      hideCloseBtn={hasBack}
      beforeHeader={hasBack && (
        <div className='relative left-[-4px] mb-1 flex cursor-pointer items-center space-x-1 py-1 text-text-accent' onClick={onBack}>
          <RiArrowLeftLine className='size-4' />
          <div className='system-xs-semibold-uppercase'>{t(`${i18nPrefix}.back`)}</div>
        </div>
      )}
    >
      <div className='space-y-3'>
        <Field label={t(`${i18nPrefix}.type`)}>
          <div className='grid grid-cols-3 gap-2'>
            <OptionCard
              title='String'
              selected={type === DataType.string}
              onSelect={handleTypeChange(DataType.string)}
            />
            <OptionCard
              title='Number'
              selected={type === DataType.number}
              onSelect={handleTypeChange(DataType.number)}
            />
            <OptionCard
              title='Time'
              selected={type === DataType.time}
              onSelect={handleTypeChange(DataType.time)}
            />
          </div>
        </Field>
        <Field label={t(`${i18nPrefix}.name`)}>
          <Input
            value={name}
            onChange={handleNameChange}
            placeholder={t(`${i18nPrefix}.namePlaceholder`)}
          />
        </Field>
      </div>
    </ModalLikeWrap>
  )
}
export default React.memo(CreateContent)
