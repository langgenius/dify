const translation = {
  knowledge: 'Wiedza',
  documentCount: ' dokumenty',
  wordCount: ' k słów',
  appCount: ' powiązane aplikacje',
  createDataset: 'Utwórz Wiedzę',
  createDatasetIntro:
    'Zaimportuj własne dane tekstowe lub zapisuj dane w czasie rzeczywistym za pomocą Webhooka w celu wzmocnienia kontekstu LLM.',
  deleteDatasetConfirmTitle: 'Czy na pewno usunąć tę Wiedzę?',
  deleteDatasetConfirmContent:
    'Usunięcie Wiedzy jest nieodwracalne. Użytkownicy nie będą już mieli dostępu do Twojej Wiedzy, a wszystkie konfiguracje i logi zostaną trwale usunięte.',
  datasetDeleted: 'Wiedza usunięta',
  datasetDeleteFailed: 'Nie udało się usunąć Wiedzy',
  didYouKnow: 'Czy wiedziałeś?',
  intro1: 'Wiedzę można zintegrować z aplikacją Dify ',
  intro2: 'jako kontekst',
  intro3: ',',
  intro4: 'lub ',
  intro5: 'może być utworzona',
  intro6: ' jako samodzielny wtyczka indeksująca ChatGPT do publikacji',
  unavailable: 'Niedostępny',
  unavailableTip:
    'Model osadzający jest niedostępny, domyślny model osadzający musi być skonfigurowany',
  datasets: 'WIEDZA',
  datasetsApi: 'DOSTĘP DO API',
  retrieval: {
    semantic_search: {
      title: 'Wyszukiwanie wektorowe',
      description:
        'Generowanie osadzeń zapytań i wyszukiwanie fragmentów tekstu najbardziej podobnych do ich wektorowej reprezentacji.',
    },
    full_text_search: {
      title: 'Wyszukiwanie pełnotekstowe',
      description:
        'Indeksowanie wszystkich terminów w dokumencie, umożliwiając użytkownikom wyszukiwanie dowolnego terminu i odzyskiwanie odpowiedniego fragmentu tekstu zawierającego te terminy.',
    },
    hybrid_search: {
      title: 'Wyszukiwanie hybrydowe',
      description:
        'Wykonaj jednocześnie pełnotekstowe wyszukiwanie i wyszukiwanie wektorowe, ponownie porządkuj, aby wybrać najlepsze dopasowanie dla zapytania użytkownika. Konieczna jest konfiguracja API Rerank model.',
      recommend: 'Polecany',
    },
    invertedIndex: {
      title: 'Indeks odwrócony',
      description:
        'Indeks odwrócony to struktura używana do efektywnego odzyskiwania informacji. Zorganizowane według terminów, każdy termin wskazuje na dokumenty lub strony internetowe zawierające go.',
    },
    change: 'Zmień',
    changeRetrievalMethod: 'Zmień metodę odzyskiwania',
  },
  docsFailedNotice: 'nie udało się zindeksować dokumentów',
  retry: 'Ponów',
}

export default translation
