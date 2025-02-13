'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import ModalLikeWrap from '../../base/modal-like-wrap'
import { useTranslation } from 'react-i18next'
import { DataType } from './types'
import Field from './field'
import OptionCard from '../../workflow/nodes/_base/components/option-card'
import Input from '@/app/components/base/input'

type Props = {
  onSave: (data: any) => void
}

const CreateModal: FC<Props> = ({
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
      title='Create'
      onClose={() => { }}
      onConfirm={handleSave}
    >
      <div className='space-y-3'>
        <Field label='Type'>
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
        <Field label='Name'>
          <Input
            value={name}
            onChange={handleNameChange}
            placeholder='Add metadata name'
          />
        </Field>
      </div>
    </ModalLikeWrap>
  )
}
export default React.memo(CreateModal)
