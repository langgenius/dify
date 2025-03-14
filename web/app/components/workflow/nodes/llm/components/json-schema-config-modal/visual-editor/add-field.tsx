import { type FC, useState } from 'react'
import type { Field } from '../../../types'
import Button from '@/app/components/base/button'
import { RiAddCircleFill } from '@remixicon/react'
import { useTranslation } from 'react-i18next'

type AddToRootProps = {
  addField: (path: string[], updates: Field) => void
}

const AddField: FC<AddToRootProps> = ({
  addField,
}) => {
  const { t } = useTranslation()
  const [isEditing, setIsEditing] = useState(false)

  const handleAddField = () => {
    setIsEditing(true)
  }

  return (
    <>
      <Button size='small' className='flex items-center gap-x-[1px]' onClick={handleAddField}>
        <RiAddCircleFill className='w-3.5 h-3.5'/>
        <span className='px-[3px]'>{t('workflow.nodes.llm.jsonSchema.addField')}</span>
      </Button>
    </>
  )
}

export default AddField
