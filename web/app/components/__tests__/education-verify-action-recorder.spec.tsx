import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EDUCATION_VERIFY_URL_SEARCHPARAMS_ACTION,
  EDUCATION_VERIFYING_LOCALSTORAGE_ITEM,
} from '@/app/education-apply/constants'
import { useSearchParams } from '@/next/navigation'
import { EducationVerifyActionRecorder } from '../education-verify-action-recorder'

vi.mock('@/next/navigation', () => ({
  useSearchParams: vi.fn(),
}))

const mockUseSearchParams = vi.mocked(useSearchParams)

describe('EducationVerifyActionRecorder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    mockUseSearchParams.mockReturnValue(new URLSearchParams() as unknown as ReturnType<typeof useSearchParams>)
  })

  it('should store the education verification flag when the callback action is present', async () => {
    mockUseSearchParams.mockReturnValue(
      new URLSearchParams(`action=${EDUCATION_VERIFY_URL_SEARCHPARAMS_ACTION}`) as unknown as ReturnType<typeof useSearchParams>,
    )

    render(<EducationVerifyActionRecorder />)

    await waitFor(() => {
      expect(window.localStorage.getItem(EDUCATION_VERIFYING_LOCALSTORAGE_ITEM)).toBe('yes')
    })
  })

  it('should leave localStorage unchanged for unrelated routes', () => {
    render(<EducationVerifyActionRecorder />)

    expect(window.localStorage.getItem(EDUCATION_VERIFYING_LOCALSTORAGE_ITEM)).toBeNull()
  })
})
