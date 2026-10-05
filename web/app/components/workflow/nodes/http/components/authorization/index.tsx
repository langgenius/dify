'use client'
import type { DialogProps } from '@langgenius/dify-ui/dialog'
import type { ReactElement } from 'react'
import type { Authorization as AuthorizationPayloadType } from '../../types'
import type { Var } from '@/app/components/workflow/types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '@langgenius/dify-ui/dialog'
import { Input } from '@langgenius/dify-ui/input'
import { produce } from 'immer'
import { useCallback, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import InputSupportSelectVar from '@/app/components/workflow/nodes/_base/components/input-support-select-var'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
import { VarType } from '@/app/components/workflow/types'
import { APIType, AuthorizationType } from '../../types'
import RadioGroup from './radio-group'

const i18nPrefix = 'nodes.http.authorization'

type AuthorizationDialogProps = Readonly<{
  nodeId: string
  payload: AuthorizationPayloadType
  onChange: (payload: AuthorizationPayloadType) => void
  readOnly: boolean
}>

function Field({
  title,
  isRequired,
  children,
  htmlFor,
}: {
  title: string
  isRequired?: boolean
  children: ReactElement
  htmlFor?: string
}) {
  return (
    <div>
      <div className="text-[13px] leading-8 font-medium text-text-secondary">
        {htmlFor ? <label htmlFor={htmlFor}>{title}</label> : title}
        {isRequired && <span className="ml-0.5 text-text-destructive">*</span>}
      </div>
      <div>{children}</div>
    </div>
  )
}

function AuthorizationForm({
  nodeId,
  payload,
  onChange,
  onSaved,
}: Omit<AuthorizationDialogProps, 'readOnly'> & { onSaved: () => void }) {
  const { t } = useTranslation(['common', 'workflowIntegrations'])
  const headerId = useId()

  const [isFocus, setIsFocus] = useState(false)
  const { availableVars, availableNodesWithParent } = useAvailableVarList(nodeId, {
    onlyLeafNodeVar: false,
    filterVar: (varPayload: Var) => {
      const textVariableTypes: readonly VarType[] = [VarType.string, VarType.number, VarType.secret]

      return textVariableTypes.includes(varPayload.type)
    },
  })

  const [tempPayload, setTempPayload] = useState<AuthorizationPayloadType>(payload)
  const handleAuthTypeChange = useCallback(
    (type: string) => {
      const newPayload = produce(tempPayload, (draft: AuthorizationPayloadType) => {
        draft.type = type as AuthorizationType
        if (draft.type === AuthorizationType.apiKey && !draft.config) {
          draft.config = {
            type: APIType.basic,
            api_key: '',
          }
        }
      })
      setTempPayload(newPayload)
    },
    [tempPayload, setTempPayload],
  )

  const handleAuthAPITypeChange = useCallback(
    (type: string) => {
      const newPayload = produce(tempPayload, (draft: AuthorizationPayloadType) => {
        if (!draft.config) {
          draft.config = {
            type: APIType.basic,
            api_key: '',
          }
        }
        draft.config.type = type as APIType
      })
      setTempPayload(newPayload)
    },
    [tempPayload, setTempPayload],
  )

  const handleAPIKeyOrHeaderChange = useCallback(
    (type: 'api_key' | 'header') => {
      return (value: string) => {
        const newPayload = produce(tempPayload, (draft: AuthorizationPayloadType) => {
          if (!draft.config) {
            draft.config = {
              type: APIType.basic,
              api_key: '',
            }
          }
          draft.config[type] = value
        })
        setTempPayload(newPayload)
      }
    },
    [tempPayload, setTempPayload],
  )

  const handleAPIKeyChange = useCallback(
    (str: string) => {
      const newPayload = produce(tempPayload, (draft: AuthorizationPayloadType) => {
        if (!draft.config) {
          draft.config = {
            type: APIType.basic,
            api_key: '',
          }
        }
        draft.config.api_key = str
      })
      setTempPayload(newPayload)
    },
    [tempPayload, setTempPayload],
  )

  return (
    <>
      <DialogTitle className="title-2xl-semi-bold text-text-primary">
        {t(($) => $[`${i18nPrefix}.authorization`], { ns: 'workflowIntegrations' })}
      </DialogTitle>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          onChange(tempPayload)
          onSaved()
        }}
      >
        <div className="space-y-2">
          <Field
            title={t(($) => $[`${i18nPrefix}.authorizationType`], { ns: 'workflowIntegrations' })}
          >
            <RadioGroup
              options={[
                {
                  value: AuthorizationType.none,
                  label: t(($) => $[`${i18nPrefix}.no-auth`], { ns: 'workflowIntegrations' }),
                },
                {
                  value: AuthorizationType.apiKey,
                  label: t(($) => $[`${i18nPrefix}.api-key`], { ns: 'workflowIntegrations' }),
                },
              ]}
              value={tempPayload.type}
              onChange={handleAuthTypeChange}
            />
          </Field>

          {tempPayload.type === AuthorizationType.apiKey && (
            <>
              <Field title={t(($) => $[`${i18nPrefix}.auth-type`], { ns: 'workflowIntegrations' })}>
                <RadioGroup
                  options={[
                    {
                      value: APIType.basic,
                      label: t(($) => $[`${i18nPrefix}.basic`], { ns: 'workflowIntegrations' }),
                    },
                    {
                      value: APIType.bearer,
                      label: t(($) => $[`${i18nPrefix}.bearer`], { ns: 'workflowIntegrations' }),
                    },
                    {
                      value: APIType.custom,
                      label: t(($) => $[`${i18nPrefix}.custom`], { ns: 'workflowIntegrations' }),
                    },
                  ]}
                  value={tempPayload.config?.type || APIType.basic}
                  onChange={handleAuthAPITypeChange}
                />
              </Field>
              {tempPayload.config?.type === APIType.custom && (
                <Field
                  htmlFor={headerId}
                  title={t(($) => $[`${i18nPrefix}.header`], { ns: 'workflowIntegrations' })}
                  isRequired
                >
                  <Input
                    id={headerId}
                    name="header"
                    value={tempPayload.config?.header || ''}
                    onValueChange={handleAPIKeyOrHeaderChange('header')}
                  />
                </Field>
              )}

              <Field
                title={t(($) => $[`${i18nPrefix}.api-key-title`], { ns: 'workflowIntegrations' })}
                isRequired
              >
                <div className="flex">
                  <InputSupportSelectVar
                    instanceId="http-api-key"
                    className={cn(
                      isFocus
                        ? 'border-components-input-border-active bg-components-input-bg-active shadow-xs'
                        : 'border-components-input-border-hover bg-components-input-bg-normal',
                      'w-0 grow rounded-lg border px-3 py-1.5',
                    )}
                    value={tempPayload.config?.api_key || ''}
                    onChange={handleAPIKeyChange}
                    nodesOutputVars={availableVars}
                    availableNodes={availableNodesWithParent}
                    onFocusChange={setIsFocus}
                    placeholder={' '}
                    placeholderClassName="leading-[21px]!"
                  />
                </div>
              </Field>
            </>
          )}
        </div>
        <div className="mt-6 flex justify-end space-x-2">
          <DialogClose render={<Button />}>
            {t(($) => $['operation.cancel'], { ns: 'common' })}
          </DialogClose>
          <Button variant="primary" type="submit">
            {t(($) => $['operation.save'], { ns: 'common' })}
          </Button>
        </div>
      </form>
    </>
  )
}

export function AuthorizationDialog({
  nodeId,
  payload,
  onChange,
  readOnly,
}: AuthorizationDialogProps) {
  const { t } = useTranslation(['workflowIntegrations'])
  const actionsRef: DialogProps['actionsRef'] = useRef(null)
  const label = (
    <span className="text-xs font-medium text-text-tertiary">
      {t(($) => $[`${i18nPrefix}.authorization`])}
      <span className="ml-1 text-text-secondary">
        {t(($) => $[`${i18nPrefix}.${payload.type}`])}
      </span>
    </span>
  )

  if (readOnly) {
    return <div className="flex h-6 items-center rounded-md px-2">{label}</div>
  }

  return (
    <Dialog actionsRef={actionsRef}>
      <DialogTrigger className="flex h-6 cursor-pointer items-center space-x-1 rounded-md px-2 hover:bg-state-base-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-state-accent-solid">
        <span
          aria-hidden
          className="i-custom-vender-line-general-settings-01 size-3 text-text-tertiary"
        />
        {label}
      </DialogTrigger>
      <DialogContent className="border-none text-left align-middle">
        <AuthorizationForm
          nodeId={nodeId}
          payload={payload}
          onChange={onChange}
          onSaved={() => actionsRef.current?.close()}
        />
      </DialogContent>
    </Dialog>
  )
}
