'use client'

import type { ComponentProps } from 'react'
import type { Credential } from '../declarations'
import type ModelModal from './index'
import { createDialogHandle } from '@langgenius/dify-ui/dialog'

export type CredentialSaved = (credential?: Credential, values?: Record<string, unknown>) => void

export const modelCredentialDialog = createDialogHandle<
  Omit<ComponentProps<typeof ModelModal>, 'onSave' | 'onCancel'> & { onSave?: CredentialSaved }
>()
