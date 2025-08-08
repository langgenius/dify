'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useRef } from 'react'
import { VariableX } from '../../../icons/src/vender/workflow'
import { VarBlockIcon } from '@/app/components/workflow/block-icon'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import { Variable02 } from '../../../icons/src/vender/solid/development'
import { useTranslation } from 'react-i18next'
import type { FormInputItem } from '@/app/components/workflow/nodes/human-input/types'
import ActionButton from '../../../action-button'
import { RiDeleteBinLine, RiEditLine } from '@remixicon/react'
import InputField from './input-field'
import { useBoolean } from 'ahooks'
import Modal from '../../../modal'

type Props = {
  nodeTitle: string
  varName: string
  isSelected: boolean
  formInput?: FormInputItem
  onChange: (input: FormInputItem) => void
}

const ComponentUI: FC<Props> = ({
  nodeTitle,
  varName,
  // isSelected,
  formInput = {
    type: InputVarType.textInput,
    output_variable_name: varName,
    placeholder: {
      type: 'const',
      selector: [],
      value: '',
    },
  },
  onChange,
}) => {
  const { t } = useTranslation()
  const [isShowEditModal, {
    setTrue: showEditModal,
    setFalse: hideEditModal,
  }] = useBoolean(false)

  const editBtnRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const editBtn = editBtnRef.current
    if (editBtn)
      editBtn.addEventListener('click', showEditModal)

    return () => {
      if (editBtn)
        editBtn.removeEventListener('click', showEditModal)
    }
  }, [])

  const handleChange = useCallback((newPayload: FormInputItem) => {
    onChange(newPayload)
    hideEditModal()
  }, [onChange])

  return (
    <div
      className='relative flex h-8 w-full select-none items-center rounded-[8px] border-[1.5px] border-components-input-border-active bg-background-default-hover pl-1.5 pr-0.5'
    >
      <div className='absolute left-2.5 top-[-12px]'>
        <div className='absolute bottom-1 h-[1.5px] w-full bg-background-default-subtle'></div>
        <div className='relative flex items-center space-x-0.5 px-1 text-text-accent-light-mode-only'>
          <VariableX className='size-3' />
          <div className='system-xs-medium'>{t('workflow.nodes.humanInput.editor.notes')}</div>
        </div>
      </div>

      <div className='flex w-full items-center justify-between'>
        {/* Node info */}
        <div className='flex h-[18px] items-center rounded-[5px] border-[0.5px] border-components-panel-border-subtle bg-components-badge-white-to-dark px-1 shadow-xs'>
          <div className='flex items-center space-x-0.5 text-text-secondary'>
            <VarBlockIcon type={BlockEnum.HumanInput} />
            <div className='system-xs-medium'>{nodeTitle}</div>
          </div>
          <div className='system-xs-regular mx-px text-divider-deep'>/</div>
          <div className='flex items-center space-x-0.5 text-text-accent'>
            <Variable02 className='size-3.5' />
            <div className='system-xs-medium'>{varName}</div>
          </div>
        </div>

        {/* Actions */}
        <div className='flex h-full items-center space-x-1 pr-[24px]'>
          <div className='flex h-full items-center' ref={editBtnRef}>
            <ActionButton size='s'>
              <RiEditLine className='size-4 text-text-tertiary' />
            </ActionButton>
          </div>

          <div className='flex h-full items-center' >
            <ActionButton size='s'>
              <RiDeleteBinLine className='size-4 text-text-tertiary' />
            </ActionButton>
          </div>
        </div>
      </div>

      {isShowEditModal && (
        <Modal
          isShow
          onClose={hideEditModal}
          wrapperClassName='z-[999]'
          className='max-w-[372px] !p-0'
        >
          <InputField
            payload={formInput}
            onChange={handleChange}
            onCancel={hideEditModal}
          />
        </Modal>
      )}
    </div>
  )
}

export default React.memo(ComponentUI)
