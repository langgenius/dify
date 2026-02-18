import { RiArrowRightLine } from '@remixicon/react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import * as React from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Checkbox from '@/app/components/base/checkbox'

type ActionsProps = {
  disabled?: boolean
  handleNextStep: () => void
  showSelect?: boolean
  totalOptions?: number
  selectedOptions?: number
  onSelectAll?: () => void
  tip?: string
}

const Actions = ({
  disabled,
  handleNextStep,
  showSelect = false,
  totalOptions,
  selectedOptions,
  onSelectAll,
  tip = '',
}: ActionsProps) => {
  const { t } = useTranslation()
  const { datasetId } = useParams()

  const indeterminate = useMemo(() => {
    if (!showSelect)
      return false
    if (selectedOptions === undefined || totalOptions === undefined)
      return false
    return selectedOptions > 0 && selectedOptions < totalOptions
  }, [showSelect, selectedOptions, totalOptions])

  const checked = useMemo(() => {
    if (!showSelect)
      return false
    if (selectedOptions === undefined || totalOptions === undefined)
      return false
    return selectedOptions > 0 && selectedOptions === totalOptions
  }, [showSelect, selectedOptions, totalOptions])

  return (
    <div className="flex items-center gap-x-2 overflow-hidden">
      {showSelect && (
        <>
          <div className="flex shrink-0 items-center gap-x-2 py-[3px] pl-4 pr-2">
            <Checkbox
              onCheck={onSelectAll}
              indeterminate={indeterminate}
              checked={checked}
            />
            <span className="system-sm-medium text-text-accent">
              {t('operation.selectAll', { ns: 'common' })}
            </span>
          </div>
          {tip && (
            <div title={tip} className="system-xs-regular max-w-full truncate text-text-tertiary">
              {tip}
            </div>
          )}
        </>
      )}
      <div className="flex grow items-center justify-end gap-x-2">
        <Link
          href={`/datasets/${datasetId}/documents`}
          replace
        >
          <Button
            variant="ghost"
            className="px-3 py-2"
          >
            {t('operation.cancel', { ns: 'common' })}
          </Button>
        </Link>
        <Button
          disabled={disabled}
          variant="primary"
          onClick={handleNextStep}
          className="gap-x-0.5"
        >
          <span className="px-0.5">{t('stepOne.button', { ns: 'datasetCreation' })}</span>
          <RiArrowRightLine className="size-4" />
        </Button>
      </div>
    </div>
  )
}

export default React.memo(Actions)
