'use client'

import type { GuideMethod, GuideStep } from './types'
import { atom } from 'jotai'

export const stepAtom = atom<GuideStep>('source')
export const methodAtom = atom<GuideMethod>('bindApp')
