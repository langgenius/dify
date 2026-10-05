'use client'
import type { DialogProps } from '@langgenius/dify-ui/dialog'
import type { Param } from '../../types'
import type { MoreInfo } from '@/app/components/workflow/types'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Input } from '@langgenius/dify-ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
  SelectValue,
} from '@langgenius/dify-ui/select'
import { Switch } from '@langgenius/dify-ui/switch'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Field from '@/app/components/app/configuration/config-var/config-modal/field'
import ConfigSelect from '@/app/components/app/configuration/config-var/config-select'
import { ChangeType } from '@/app/components/workflow/types'
import { toast } from '@/app/notifications'
import { checkKeys } from '@/utils/var'
import { ParamType } from '../../types'

const i18nPrefix = 'nodes.parameterExtractor'
const errorI18nPrefix = 'errorMsg'

const DEFAULT_PARAM: Param = {
  name: '',
  type: ParamType.string,
  description: '',
  required: false,
}

type Props = Readonly<{
  onSave: (payload: Param, moreInfo?: MoreInfo) => void
}> &
  ({ type: 'add'; payload?: never } | { type: 'edit'; payload: Param })

const TYPES = [
  ParamType.string,
  ParamType.number,
  ParamType.bool,
  ParamType.arrayString,
  ParamType.arrayNumber,
  ParamType.arrayObject,
  ParamType.arrayBool,
]

export function ParameterDialog(props: Props) {
  const { t } = useTranslation(['common', 'workflowModels'])
  const actionsRef: DialogProps['actionsRef'] = useRef(null)
  const isAdd = props.type === 'add'
  const triggerLabel = isAdd
    ? t(($) => $[`${i18nPrefix}.addExtractParameter`], { ns: 'workflowModels' })
    : `${t(($) => $['operation.edit'], { ns: 'common' })} ${props.payload.name}`

  return (
    <Dialog actionsRef={actionsRef}>
      <DialogTrigger
        render={
          <IconButton aria-label={triggerLabel} className={isAdd ? 'mx-1' : undefined}>
            <span
              aria-hidden="true"
              className={isAdd ? 'i-ri-add-line size-4' : 'i-ri-edit-line size-4'}
            />
          </IconButton>
        }
      />
      <DialogContent className="w-100! max-w-100! overflow-hidden! border-none p-4! text-left align-middle">
        <DialogTitle className="title-2xl-semi-bold text-text-primary">{triggerLabel}</DialogTitle>
        <ParameterForm {...props} onSaved={() => actionsRef.current?.close()} />
      </DialogContent>
    </Dialog>
  )
}

function ParameterForm({ type, payload, onSave, onSaved }: Props & { onSaved: () => void }) {
  const { t } = useTranslation(['appDebug', 'common', 'workflow', 'workflowModels'])
  const nameLabel = t(($) => $[`${i18nPrefix}.addExtractParameterContent.name`], {
    ns: 'workflowModels',
  })
  const isAdd = type === 'add'
  const [initialParam] = useState(isAdd ? DEFAULT_PARAM : payload)
  const [param, setParam] = useState<Param>(initialParam)
  const handleParamChange =
    <K extends keyof Param>(key: K) =>
    (value: Param[K]) => {
      if (key === 'name') {
        const { isValid, errorKey, errorMessageKey } = checkKeys([value as string], true)
        if (!isValid) {
          toast.error(
            t(($) => $[`varKeyError.${errorMessageKey}`], { ns: 'appDebug', key: errorKey }),
          )
          return
        }
      }
      setParam((prev) => ({ ...prev, [key]: value }))
    }

  const checkValid = useCallback(() => {
    let errMessage = ''
    if (!param.name)
      errMessage = t(($) => $[`${errorI18nPrefix}.fieldRequired`], {
        ns: 'workflow',
        field: t(($) => $[`${i18nPrefix}.addExtractParameterContent.name`], {
          ns: 'workflowModels',
        }),
      })
    if (
      !errMessage &&
      param.type === ParamType.select &&
      (!param.options || param.options.length === 0)
    )
      errMessage = t(($) => $[`${errorI18nPrefix}.fieldRequired`], {
        ns: 'workflow',
        field: t(($) => $['variableConfig.options'], { ns: 'appDebug' }),
      })
    if (!errMessage && !param.description)
      errMessage = t(($) => $[`${errorI18nPrefix}.fieldRequired`], {
        ns: 'workflow',
        field: t(($) => $[`${i18nPrefix}.addExtractParameterContent.description`], {
          ns: 'workflowModels',
        }),
      })

    if (errMessage) {
      toast.error(errMessage)
      return false
    }
    return true
  }, [param, t])

  const handleSave = () => {
    if (!checkValid()) return
    const renameInfo: MoreInfo | undefined =
      !isAdd && initialParam.name !== param.name
        ? {
            type: ChangeType.changeVarName,
            payload: { beforeKey: initialParam.name, afterKey: param.name },
          }
        : undefined
    onSave(param, renameInfo)
    onSaved()
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        handleSave()
      }}
    >
      <div className="space-y-2">
        <Field title={nameLabel}>
          <Input
            aria-label={nameLabel}
            value={param.name}
            onValueChange={(value) => handleParamChange('name')(value)}
            placeholder={t(($) => $[`${i18nPrefix}.addExtractParameterContent.namePlaceholder`], {
              ns: 'workflow',
            })!}
          />
        </Field>
        <Field
          title={t(($) => $[`${i18nPrefix}.addExtractParameterContent.type`], {
            ns: 'workflowModels',
          })}
        >
          <Select<ParamType>
            value={param.type}
            onValueChange={(value) => value && handleParamChange('type')(value)}
          >
            <SelectTrigger
              aria-label={t(($) => $[`${i18nPrefix}.addExtractParameterContent.type`], {
                ns: 'workflowModels',
              })}
              className="w-full capitalize"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPES.map((type) => (
                <SelectItem<ParamType> key={type} value={type} className="capitalize">
                  <SelectItemText className="capitalize">{type}</SelectItemText>
                  <SelectItemIndicator />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {param.type === ParamType.select && (
          <Field title={t(($) => $['variableConfig.options'], { ns: 'appDebug' })}>
            <ConfigSelect options={param.options || []} onChange={handleParamChange('options')} />
          </Field>
        )}
        <Field
          title={t(($) => $[`${i18nPrefix}.addExtractParameterContent.description`], {
            ns: 'workflowModels',
          })}
        >
          <Textarea
            aria-label={t(($) => $[`${i18nPrefix}.addExtractParameterContent.description`], {
              ns: 'workflowModels',
            })}
            value={param.description}
            onValueChange={(value) => handleParamChange('description')(value)}
            placeholder={t(
              ($) => $[`${i18nPrefix}.addExtractParameterContent.descriptionPlaceholder`],
              { ns: 'workflow' },
            )!}
          />
        </Field>
        <Field
          title={t(($) => $[`${i18nPrefix}.addExtractParameterContent.required`], {
            ns: 'workflowModels',
          })}
        >
          <>
            <div className="mb-1.5 text-xs leading-4.5 font-normal text-text-tertiary">
              {t(($) => $[`${i18nPrefix}.addExtractParameterContent.requiredContent`], {
                ns: 'workflowModels',
              })}
            </div>
            <Switch
              size="lg"
              aria-label={t(($) => $[`${i18nPrefix}.addExtractParameterContent.required`], {
                ns: 'workflowModels',
              })}
              checked={param.required ?? false}
              onCheckedChange={handleParamChange('required')}
            />
          </>
        </Field>
      </div>
      <div className="mt-4 flex justify-end space-x-2">
        <DialogClose render={<Button className="w-23.75!" />}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </DialogClose>
        <Button type="submit" className="w-23.75!" variant="primary">
          {isAdd
            ? t(($) => $['operation.add'], { ns: 'common' })
            : t(($) => $['operation.save'], { ns: 'common' })}
        </Button>
      </div>
    </form>
  )
}
