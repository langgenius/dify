import {
  memo,
  useCallback,
} from 'react'
import { useStore } from '@/app/components/workflow/store'
import { RiCloseLine } from '@remixicon/react'
import { Jina } from '@/app/components/base/icons/src/public/llm'
import { InputVarType } from '@/app/components/workflow/types'
import Tooltip from '@/app/components/base/tooltip'
import DialogWrapper from './dialog-wrapper'
import FieldList from './field-list'
import FooterTip from './footer-tip'

type InputFieldDialogProps = {
  readonly?: boolean
}

const InputFieldDialog = ({
  readonly = false,
}: InputFieldDialogProps) => {
  const showInputFieldDialog = useStore(state => state.showInputFieldDialog)
  const setShowInputFieldDialog = useStore(state => state.setShowInputFieldDialog)

  const closePanel = useCallback(() => {
    setShowInputFieldDialog?.(false)
  }, [setShowInputFieldDialog])

  return (
    <DialogWrapper
      show={!!showInputFieldDialog}
      onClose={closePanel}
    >
      <div className='flex grow flex-col'>
        <div className='flex items-center p-4 pb-0'>
          {/* // TODO： i18n */}
          <div className='system-xl-semibold grow'>
            User input fields
          </div>
          <button
            type='button'
            className='flex size-6 shrink-0 items-center justify-center p-0.5'
            onClick={closePanel}
          >
            <RiCloseLine className='size-4 text-text-tertiary' />
          </button>
        </div>
        <div className='system-sm-regular px-4 py-1 text-text-tertiary'>
          User input fields are used to define and collect variables required during the pipeline execution process. Users can customize the field type and flexibly configure the input value to meet the needs of different data sources or document processing steps.
        </div>
        <div className='flex grow flex-col overflow-y-auto'>
          {/* Jina Reader Field List */}
          <FieldList
            LabelRightContent={(
              <div className='flex items-center gap-x-1.5'>
                <div className='flex size-5 items-center justify-center rounded-md border-[0.5px] border-components-panel-border-subtle bg-background-default'>
                  <Jina className='size-3.5' />
                </div>
                <span className='system-sm-medium text-text-secondary'>Jina Reader</span>
              </div>
            )}
            inputFields={[{
              variable: 'name',
              label: 'name',
              type: InputVarType.textInput,
              required: true,
              max_length: 12,
            }, {
              variable: 'num',
              label: 'num',
              type: InputVarType.number,
              required: true,
            }]}
            readonly={readonly}
            labelClassName='pt-2 pb-1'
          />
          {/* Firecrawl Field List */}
          <FieldList
            LabelRightContent={(
              <div className='flex items-center gap-x-1.5'>
                <div className='flex size-5 items-center justify-center rounded-md border-[0.5px] border-components-panel-border-subtle bg-background-default'>
                  <span className='text-[14px] leading-[14px]'>🔥</span>
                </div>
                <span className='system-sm-medium text-text-secondary'>Firecrawl</span>
              </div>
            )}
            inputFields={[{
              variable: 'name',
              label: 'name',
              type: InputVarType.textInput,
              required: true,
              max_length: 12,
            }]}
            readonly={readonly}
            labelClassName='pt-2 pb-1'
          />
          {/* Shared Inputs */}
          <FieldList
            LabelRightContent={(
              <div className='flex items-center gap-x-1'>
                <span className='system-sm-medium text-text-secondary'>SHARED INPUTS</span>
                <Tooltip
                  popupContent='Shared Inputs are available to all downstream nodes across data sources. For example, variables like delimiter and maximum chunk length can be uniformly applied when processing documents from multiple sources.'
                  popupClassName='!w-[300px]'
                />
              </div>
            )}
            inputFields={[{
              variable: 'name',
              label: 'name',
              type: InputVarType.textInput,
              required: true,
              max_length: 12,
            }]}
            readonly={readonly}
            labelClassName='pt-1 pb-2'
          />
        </div>
        <FooterTip />
      </div>
    </DialogWrapper>
  )
}

export default memo(InputFieldDialog)
