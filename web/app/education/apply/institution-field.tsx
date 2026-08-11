import type { AutocompleteChangeEventDetails } from '@langgenius/dify-ui/autocomplete'
import type { UIEventHandler } from 'react'
import {
  Autocomplete,
  AutocompleteContent,
  AutocompleteEmpty,
  AutocompleteInput,
  AutocompleteInputGroup,
  AutocompleteItem,
  AutocompleteItemText,
  AutocompleteList,
  AutocompleteStatus,
} from '@langgenius/dify-ui/autocomplete'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useDebouncedValue } from 'foxact/use-debounced-value'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { consoleQuery } from '@/service/client'

const EDUCATION_AUTOCOMPLETE_PAGE_SIZE = 40

type InstitutionFieldProps = {
  value: string
  onValueChange: (value: string) => void
}

const InstitutionField = ({ value, onValueChange }: InstitutionFieldProps) => {
  const { t } = useTranslation()
  const inputId = useId()
  const [isPopupOpen, setIsPopupOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 300)
  const isSearchReady = !!searchQuery && searchQuery === debouncedSearchQuery
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isPending, isSuccess } =
    useInfiniteQuery({
      ...consoleQuery.account.education.autocomplete.get.infiniteOptions({
        input: (pageParam) => ({
          query: {
            keywords: debouncedSearchQuery,
            limit: EDUCATION_AUTOCOMPLETE_PAGE_SIZE,
            page: Number(pageParam),
          },
        }),
        initialPageParam: 0,
        getNextPageParam: (lastPage, pages) =>
          lastPage.has_next ? (lastPage.curr_page ?? pages.length - 1) + 1 : undefined,
      }),
      enabled: isSearchReady,
    })
  const suggestions = isSearchReady ? (data?.pages.flatMap((page) => page.data ?? []) ?? []) : []
  const isLoading = isPending || isFetchingNextPage
  const shouldOpenPopup = isPopupOpen && isSearchReady && (isLoading || isSuccess)

  const handleValueChange = (inputValue: string, eventDetails: AutocompleteChangeEventDetails) => {
    onValueChange(inputValue)
    if (eventDetails.reason === 'item-press') {
      setSearchQuery('')
      setIsPopupOpen(false)
      return
    }

    setSearchQuery(inputValue)
    setIsPopupOpen(!!inputValue)
  }

  const handleScroll: UIEventHandler<HTMLDivElement> = (event) => {
    const { scrollTop, scrollHeight, clientHeight } = event.currentTarget
    const isAtBottom = scrollTop + clientHeight >= scrollHeight - 5 && scrollTop > 0
    if (!isAtBottom || !hasNextPage || isFetchingNextPage) return

    void fetchNextPage()
  }

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
        open={shouldOpenPopup}
        onOpenChange={setIsPopupOpen}
      >
        <AutocompleteInputGroup size="large">
          <AutocompleteInput
            id={inputId}
            size="large"
            placeholder={t(($) => $['form.schoolName.placeholder'], { ns: 'education' })}
          />
        </AutocompleteInputGroup>
        <AutocompleteContent
          popupClassName="w-(--anchor-width) max-w-(--available-width)"
          portalProps={{ keepMounted: true }}
          popupProps={{ 'aria-busy': isLoading || undefined }}
        >
          <AutocompleteList<string> onScroll={handleScroll}>
            {(institution) => (
              <AutocompleteItem key={institution} value={institution} title={institution}>
                <AutocompleteItemText>{institution}</AutocompleteItemText>
              </AutocompleteItem>
            )}
          </AutocompleteList>
          <AutocompleteEmpty>
            {!isLoading ? t(($) => $['form.schoolName.noResults'], { ns: 'education' }) : null}
          </AutocompleteEmpty>
          <AutocompleteStatus className="p-0">
            {isLoading ? (
              <>
                <span className="sr-only">{t(($) => $.loading, { ns: 'appApi' })}</span>
                <div aria-hidden="true">
                  <Loading className="h-10" />
                </div>
              </>
            ) : null}
          </AutocompleteStatus>
        </AutocompleteContent>
      </Autocomplete>
    </Field>
  )
}

export default InstitutionField
