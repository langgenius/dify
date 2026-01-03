import { RiAddCircleFill } from '@remixicon/react'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { useMittContext } from './context'
import { useVisualEditorStore } from './store'

const AddField = () => {
  const { t } = useTranslation()
  const setIsAddingNewField = useVisualEditorStore(state => state.setIsAddingNewField)
  const { emit } = useMittContext()

  const handleAddField = useCallback(() => {
    setIsAddingNewField(true)
    // fix: when user change the last property type, the 'hoveringProperty' value will be reset by 'setHoveringPropertyDebounced(null)', that cause the EditCard not showing
    setTimeout(() => {
      emit('addField', { path: [] })
    }, 100)
  }, [setIsAddingNewField, emit])

  return (
    <div className="py-2 pl-5">
      <Button
        size="small"
        variant="secondary-accent"
        className="flex items-center gap-x-[1px]"
        onClick={handleAddField}
      >
        <RiAddCircleFill className="h-3.5 w-3.5" />
        <span className="px-[3px]">{t('nodes.llm.jsonSchema.addField', { ns: 'workflow' })}</span>
      </Button>
    </div>
  )
}

export default React.memo(AddField)
