import type { UIEventHandler } from 'react'
import {
  Autocomplete,
  AutocompleteContent,
  AutocompleteInput,
  AutocompleteInputGroup,
  AutocompleteItem,
  AutocompleteItemText,
  AutocompleteList,
  AutocompleteStatus,
} from '@langgenius/dify-ui/autocomplete'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { useCallback, useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useInstitutionSuggestions } from './use-institution-suggestions'

type InstitutionFieldProps = {
  value: string
  onValueChange: (value: string) => void
}

const InstitutionField = ({ value, onValueChange }: InstitutionFieldProps) => {
  const { t } = useTranslation()
  const inputId = useId()
  const {
    suggestions,
    clearSuggestions,
    requestSuggestions,
    requestSuggestionsDebounced,
    hasNextPage,
    isPending,
  } = useInstitutionSuggestions()
  const pageRef = useRef(0)

  const handleValueChange = useCallback(
    (inputValue: string) => {
      clearSuggestions()
      pageRef.current = 0
      onValueChange(inputValue)
      requestSuggestionsDebounced({ query: inputValue, page: 0 })
    },
    [clearSuggestions, onValueChange, requestSuggestionsDebounced],
  )

  const handleScroll: UIEventHandler<HTMLDivElement> = useCallback(
    (event) => {
      const { scrollTop, scrollHeight, clientHeight } = event.currentTarget
      const isAtBottom = scrollTop + clientHeight >= scrollHeight - 5 && scrollTop > 0
      if (!isAtBottom || !hasNextPage || isPending) return

      pageRef.current += 1
      requestSuggestions({ query: value, page: pageRef.current })
    },
    [hasNextPage, isPending, requestSuggestions, value],
  )

  return (
    <Field name="institution" className="mb-7">
      <FieldLabel
        className="flex h-6 items-center py-0 system-md-semibold text-text-secondary"
        htmlFor={inputId}
      >
        {t(($) => $['form.schoolName.title'], { ns: 'education' })}
      </FieldLabel>
      <Autocomplete
        items={suggestions}
        value={value}
        onValueChange={handleValueChange}
        filter={null}
        mode="list"
      >
        <AutocompleteInputGroup size="large">
          <AutocompleteInput
            id={inputId}
            size="large"
            placeholder={t(($) => $['form.schoolName.placeholder'], { ns: 'education' })}
          />
        </AutocompleteInputGroup>
        {!!value && (isPending || suggestions.length > 0) && (
          <AutocompleteContent
            popupClassName="w-(--anchor-width)"
            popupProps={{ 'aria-busy': isPending || undefined }}
          >
            {isPending && (
              <AutocompleteStatus>{t(($) => $.loading, { ns: 'appApi' })}</AutocompleteStatus>
            )}
            <AutocompleteList<string> onScroll={handleScroll}>
              {(institution) => (
                <AutocompleteItem key={institution} value={institution} title={institution}>
                  <AutocompleteItemText>{institution}</AutocompleteItemText>
                </AutocompleteItem>
              )}
            </AutocompleteList>
          </AutocompleteContent>
        )}
      </Autocomplete>
    </Field>
  )
}

export default InstitutionField
