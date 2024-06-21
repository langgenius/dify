const translation = {
  title: 'Ustawienia wiedzy',
  desc: 'Tutaj możesz modyfikować właściwości i metody działania Wiedzy.',
  form: {
    name: 'Nazwa wiedzy',
    namePlaceholder: 'Proszę wprowadzić nazwę wiedzy',
    nameError: 'Nazwa nie może być pusta',
    desc: 'Opis wiedzy',
    descInfo:
      'Proszę napisać klarowny opis tekstowy, aby zarysować zawartość Wiedzy. Ten opis będzie wykorzystywany jako podstawa do dopasowywania podczas wyboru z wielu wiedz dla wnioskowania.',
    descPlaceholder:
      'Opisz, co znajduje się w tej Wiedzy. Szczegółowy opis pozwala sztucznej inteligencji na dostęp do treści Wiedzy w odpowiednim czasie. Jeśli jest pusty, Dify użyje domyślnej strategii trafień.',
    descWrite: 'Dowiedz się, jak napisać dobry opis Wiedzy.',
    permissions: 'Uprawnienia',
    permissionsOnlyMe: 'Tylko ja',
    permissionsAllMember: 'Wszyscy członkowie zespołu',
    indexMethod: 'Metoda indeksowania',
    indexMethodHighQuality: 'Wysoka jakość',
    indexMethodHighQualityTip:
      'Wywołaj model Embedding do przetwarzania, aby zapewnić większą dokładność przy zapytaniach użytkowników.',
    indexMethodEconomy: 'Ekonomiczna',
    indexMethodEconomyTip:
      'Użyj silników wektorów offline, indeksów słów kluczowych itp., aby zmniejszyć dokładność bez wydawania tokenów',
    embeddingModel: 'Model wbudowywania',
    embeddingModelTip: 'Aby zmienić model wbudowywania, przejdź do ',
    embeddingModelTipLink: 'Ustawienia',
    retrievalSetting: {
      title: 'Ustawienia doboru',
      learnMore: 'Dowiedz się więcej',
      description: ' dotyczące metody doboru.',
      longDescription:
        ' dotyczące metody doboru, możesz to zmienić w dowolnym momencie w ustawieniach wiedzy.',
    },
    save: 'Zapisz',
  },
}

export default translation
