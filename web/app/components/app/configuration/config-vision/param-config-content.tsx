'use client'
import type { FC } from 'react'
import type { FileUpload } from '@/app/components/base/features/types'
import { Field, FieldItem } from '@langgenius/dify-ui/field'
import { Fieldset, FieldsetLegend } from '@langgenius/dify-ui/fieldset'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import { RadioGroup, RadioItem } from '@langgenius/dify-ui/radio-group'
import { produce } from 'immer'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useFeatures, useFeaturesStore } from '@/app/components/base/features/hooks'
import ParamItem from '@/app/components/base/param-item'
import { Resolution, TransferMethod } from '@/types/app'

const MIN = 1
const MAX = 6
const optionClassName =
  'flex h-8 w-full cursor-default items-center justify-center rounded-md border border-components-option-card-option-border bg-components-option-card-option-bg px-2 system-sm-regular text-text-secondary data-unchecked:cursor-pointer data-unchecked:hover:border-components-option-card-option-border-hover data-unchecked:hover:bg-components-option-card-option-bg-hover data-unchecked:hover:shadow-xs focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden data-checked:border-[1.5px] data-checked:border-components-option-card-option-selected-border data-checked:bg-components-option-card-option-selected-bg data-checked:system-sm-medium data-checked:shadow-xs'
const ParamConfigContent: FC = () => {
  const { t } = useTranslation()
  const file = useFeatures((s) => s.features.file)
  const featuresStore = useFeaturesStore()

  const handleChange = useCallback(
    (data: FileUpload) => {
      const { features, setFeatures } = featuresStore!.getState()

      const newFeatures = produce(features, (draft) => {
        draft.file = {
          ...draft.file,
          allowed_file_upload_methods: data.allowed_file_upload_methods,
          number_limits: data.number_limits,
          image: {
            enabled: data.enabled,
            detail: data.image?.detail,
            transfer_methods: data.allowed_file_upload_methods,
            number_limits: data.number_limits,
          },
        }
      })
      setFeatures(newFeatures)
    },
    [featuresStore],
  )

  const uploadMethod =
    file?.allowed_file_upload_methods?.length === 1
      ? (file.allowed_file_upload_methods[0] ?? null)
      : file?.allowed_file_upload_methods?.includes(TransferMethod.local_file) &&
          file.allowed_file_upload_methods.includes(TransferMethod.remote_url)
        ? 'both'
        : null

  return (
    <div className="space-y-6 pt-3">
      <Field>
        <Fieldset
          render={
            <RadioGroup<Resolution | null>
              value={file?.image?.detail ?? null}
              onValueChange={(detail) => {
                if (detail) handleChange({ ...file, image: { detail } })
              }}
              className="block"
            />
          }
        >
          <div className="mb-2 flex items-center space-x-1">
            <FieldsetLegend className="m-0 py-0 text-[13px] leading-4.5 font-semibold text-text-secondary">
              {t(($) => $['vision.visionSettings.resolution'], { ns: 'appDebug' })}
            </FieldsetLegend>
            <Infotip>
              <InfotipTrigger
                aria-label={t(($) => $['vision.visionSettings.resolutionTooltip'], {
                  ns: 'appDebug',
                })}
              />
              <InfotipContent
                aria-label={t(($) => $['vision.visionSettings.resolutionTooltip'], {
                  ns: 'appDebug',
                })}
                className="w-45 whitespace-pre-wrap"
              >
                {t(($) => $['vision.visionSettings.resolutionTooltip'], { ns: 'appDebug' })}
              </InfotipContent>
            </Infotip>
          </div>
          <div className="flex items-center gap-1">
            {[
              {
                value: Resolution.high,
                label: t(($) => $['vision.visionSettings.high'], { ns: 'appDebug' }),
              },
              {
                value: Resolution.low,
                label: t(($) => $['vision.visionSettings.low'], { ns: 'appDebug' }),
              },
            ].map((option) => (
              <FieldItem key={option.value} className="grow">
                <RadioItem<Resolution>
                  value={option.value}
                  nativeButton
                  render={<button type="button" />}
                  className={optionClassName}
                >
                  {option.label}
                </RadioItem>
              </FieldItem>
            ))}
          </div>
        </Fieldset>
      </Field>
      <Field>
        <Fieldset
          render={
            <RadioGroup<TransferMethod | 'both' | null>
              value={uploadMethod}
              onValueChange={(method) => {
                if (!method) return
                handleChange({
                  ...file,
                  allowed_file_upload_methods:
                    method === 'both'
                      ? [TransferMethod.local_file, TransferMethod.remote_url]
                      : [method],
                })
              }}
              className="block"
            />
          }
        >
          <FieldsetLegend className="mb-2 py-0 text-[13px] leading-4.5 font-semibold text-text-secondary">
            {t(($) => $['vision.visionSettings.uploadMethod'], { ns: 'appDebug' })}
          </FieldsetLegend>
          <div className="flex items-center gap-1">
            {[
              {
                value: 'both' as const,
                label: t(($) => $['vision.visionSettings.both'], { ns: 'appDebug' }),
              },
              {
                value: TransferMethod.local_file,
                label: t(($) => $['vision.visionSettings.localUpload'], { ns: 'appDebug' }),
              },
              {
                value: TransferMethod.remote_url,
                label: t(($) => $['vision.visionSettings.url'], { ns: 'appDebug' }),
              },
            ].map((option) => (
              <FieldItem key={option.value} className="grow">
                <RadioItem<TransferMethod | 'both'>
                  value={option.value}
                  nativeButton
                  render={<button type="button" />}
                  className={optionClassName}
                >
                  {option.label}
                </RadioItem>
              </FieldItem>
            ))}
          </div>
        </Fieldset>
      </Field>
      <div>
        <ParamItem
          id="upload_limit"
          className=""
          name={t(($) => $['vision.visionSettings.uploadLimit'], { ns: 'appDebug' })}
          noTooltip
          {...{
            default: 2,
            step: 1,
            min: MIN,
            max: MAX,
          }}
          value={file?.number_limits || 3}
          enable={true}
          onChange={(_key: string, value: number) => {
            if (!value) return

            handleChange({
              ...file,
              number_limits: value,
            })
          }}
        />
      </div>
    </div>
  )
}

export default React.memo(ParamConfigContent)
