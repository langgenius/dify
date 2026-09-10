'use client'
import type { FC } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { Input } from '@langgenius/dify-ui/input'
import { NumberField, NumberFieldGroup, NumberFieldInput } from '@langgenius/dify-ui/number-field'
import { RiAddLine } from '@remixicon/react'
import { produce } from 'immer'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import RemoveButton from '@/app/components/workflow/nodes/_base/components/remove-button'

type Props = Readonly<{
  isString: boolean
  list: Array<string | number | undefined>
  onChange: (list: Array<string | number | undefined>) => void
}>

const ArrayValueList: FC<Props> = ({ isString = true, list, onChange }) => {
  const { t } = useTranslation()

  const handleValueChange = useCallback(
    (index: number) => {
      return (value: string | number | undefined) => {
        const newList = produce(list, (draft) => {
          draft[index] = value
        })
        onChange(newList)
      }
    },
    [list, onChange],
  )

  const handleItemRemove = useCallback(
    (index: number) => {
      return () => {
        const newList = produce(list, (draft) => {
          draft.splice(index, 1)
        })
        onChange(newList)
      }
    },
    [list, onChange],
  )

  const handleItemAdd = useCallback(() => {
    const newList = produce(list, (draft) => {
      draft.push(undefined)
    })
    onChange(newList)
  }, [list, onChange])

  return (
    <div className="w-full space-y-2">
      {list.map((item, index) => (
        <div className="flex items-center gap-1" key={index}>
          {isString ? (
            <Input
              className="min-w-0 flex-1"
              aria-label={`${t(($) => $['chatVariable.modal.arrayValue'], { ns: 'workflow' })} ${index + 1}`}
              placeholder={t(($) => $['chatVariable.modal.arrayValue'], { ns: 'workflow' })}
              value={typeof item === 'string' ? item : ''}
              onValueChange={handleValueChange(index)}
            />
          ) : (
            <NumberField
              format={{ maximumSignificantDigits: 21, useGrouping: false }}
              className="min-w-0 flex-1"
              value={typeof item === 'number' ? item : null}
              onValueChange={(value) => handleValueChange(index)(value ?? undefined)}
            >
              <NumberFieldGroup>
                <NumberFieldInput
                  inputMode="decimal"
                  aria-label={`${t(($) => $['chatVariable.modal.arrayValue'], { ns: 'workflow' })} ${index + 1}`}
                  placeholder={t(($) => $['chatVariable.modal.arrayValue'], { ns: 'workflow' })}
                />
              </NumberFieldGroup>
            </NumberField>
          )}
          <RemoveButton
            className="bg-gray-100! p-2! hover:bg-gray-200!"
            onClick={handleItemRemove(index)}
          />
        </div>
      ))}
      <Button variant="tertiary" className="w-full" onClick={handleItemAdd}>
        <RiAddLine className="size-4" aria-hidden />
        <span>{t(($) => $['chatVariable.modal.addArrayValue'], { ns: 'workflow' })}</span>
      </Button>
    </div>
  )
}
export default React.memo(ArrayValueList)
