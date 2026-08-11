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
import { useEducation } from './hooks'

type SearchInputProps = {
  value?: string
  onChange: (value: string) => void
}

const SearchInput = ({ value, onChange }: SearchInputProps) => {
  const { t } = useTranslation()
  const inputId = useId()
  const {
    schools,
    setSchools,
    querySchoolsWithDebounced,
    handleUpdateSchools,
    hasNext,
    isLoading,
  } = useEducation()
  const pageRef = useRef(0)
  const valueRef = useRef(value)

  const handleSearch = useCallback(
    (debounced?: boolean) => {
      const keywords = valueRef.current
      const page = pageRef.current
      if (debounced) {
        querySchoolsWithDebounced({
          keywords,
          page,
        })
        return
      }

      handleUpdateSchools({
        keywords,
        page,
      })
    },
    [handleUpdateSchools, querySchoolsWithDebounced],
  )

  const handleValueChange = useCallback(
    (inputValue: string) => {
      setSchools([])
      pageRef.current = 0
      valueRef.current = inputValue
      onChange(inputValue)
      handleSearch(true)
    },
    [handleSearch, onChange, setSchools],
  )

  const handleScroll: UIEventHandler<HTMLDivElement> = useCallback(
    (e) => {
      const target = e.currentTarget
      const { scrollTop, scrollHeight, clientHeight } = target
      if (scrollTop + clientHeight >= scrollHeight - 5 && scrollTop > 0 && hasNext) {
        pageRef.current += 1
        handleSearch()
      }
    },
    [handleSearch, hasNext],
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
        items={schools}
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
        {!!value && (isLoading || schools.length > 0) && (
          <AutocompleteContent popupProps={{ 'aria-busy': isLoading || undefined }}>
            {isLoading && (
              <AutocompleteStatus>{t(($) => $.loading, { ns: 'appApi' })}</AutocompleteStatus>
            )}
            <AutocompleteList<string> onScroll={handleScroll}>
              {(school) => (
                <AutocompleteItem key={school} value={school} title={school}>
                  <AutocompleteItemText>{school}</AutocompleteItemText>
                </AutocompleteItem>
              )}
            </AutocompleteList>
          </AutocompleteContent>
        )}
      </Autocomplete>
    </Field>
  )
}

export default SearchInput
