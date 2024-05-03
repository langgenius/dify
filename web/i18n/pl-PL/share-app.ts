const translation = {
  common: {
    welcome: 'Witaj w użyciu',
    appUnavailable: 'Aplikacja jest niedostępna',
    appUnkonwError: 'Aplikacja jest niedostępna',
  },
  chat: {
    newChat: 'Nowy czat',
    pinnedTitle: 'Przypięte',
    unpinnedTitle: 'Czaty',
    newChatDefaultName: 'Nowa rozmowa',
    resetChat: 'Resetuj rozmowę',
    powerBy: 'Działany przez',
    prompt: 'Podpowiedź',
    privatePromptConfigTitle: 'Ustawienia rozmowy',
    publicPromptConfigTitle: 'Początkowa podpowiedź',
    configStatusDes:
      'Przed rozpoczęciem możesz zmodyfikować ustawienia rozmowy',
    configDisabled: 'Ustawienia poprzedniej sesji zostały użyte w tej sesji.',
    startChat: 'Zacznij czat',
    privacyPolicyLeft: 'Proszę przeczytać ',
    privacyPolicyMiddle: 'politykę prywatności',
    privacyPolicyRight: ' dostarczoną przez dewelopera aplikacji.',
    deleteConversation: {
      title: 'Usuń rozmowę',
      content: 'Czy na pewno chcesz usunąć tę rozmowę?',
    },
    tryToSolve: 'Spróbuj rozwiązać',
    temporarySystemIssue: 'Przepraszamy, tymczasowy problem systemowy.',
  },
  generation: {
    tabs: {
      create: 'Uruchom raz',
      batch: 'Uruchom partię',
      saved: 'Zapisane',
    },
    savedNoData: {
      title: 'Nie zapisałeś jeszcze wyniku!',
      description:
        'Zacznij generować treść i znajdź swoje zapisane wyniki tutaj.',
      startCreateContent: 'Zacznij tworzyć treść',
    },
    title: 'Uzupełnianie AI',
    queryTitle: 'Zapytaj o treść',
    completionResult: 'Wynik uzupełnienia',
    queryPlaceholder: 'Wpisz swoją treść zapytania...',
    run: 'Wykonaj',
    copy: 'Kopiuj',
    resultTitle: 'Uzupełnianie AI',
    noData: 'AI poda Ci to, czego chcesz tutaj.',
    csvUploadTitle: 'Przeciągnij i upuść plik CSV tutaj lub ',
    browse: 'przeglądaj',
    csvStructureTitle: 'Plik CSV musi być zgodny z następującą strukturą:',
    downloadTemplate: 'Pobierz szablon tutaj',
    field: 'Pole',
    batchFailed: {
      info: '{{num}} nieudanych wykonan',
      retry: 'Powtórz',
      outputPlaceholder: 'Brak treści wyjściowej',
    },
    errorMsg: {
      empty: 'Proszę wprowadź treść w załadowanym pliku.',
      fileStructNotMatch: 'Załadowany plik CSV nie pasuje do struktury.',
      emptyLine: 'Wiersz {{rowIndex}} jest pusty',
      invalidLine:
        'Wiersz {{rowIndex}}: wartość {{varName}} nie może być pusta',
      moreThanMaxLengthLine:
        'Wiersz {{rowIndex}}: wartość {{varName}} nie może mieć więcej niż {{maxLength}} znaków',
      atLeastOne:
        'Proszę wprowadź co najmniej jeden wiersz w załadowanym pliku.',
    },
  },
}

export default translation
