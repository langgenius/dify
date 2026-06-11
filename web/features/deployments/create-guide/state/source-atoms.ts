'use client'

import type { WorkflowSourceApp } from './types'
import { atom } from 'jotai'

export const sourceSearchTextAtom = atom('')
export const selectedAppAtom = atom<WorkflowSourceApp | undefined>(undefined)
