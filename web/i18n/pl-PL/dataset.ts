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
  datasetUsedByApp: 'Ta wiedza jest wykorzystywana przez niektóre aplikacje. Aplikacje nie będą już mogły korzystać z tej Wiedzy, a wszystkie konfiguracje podpowiedzi i logi zostaną trwale usunięte.',
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
  indexingTechnique: {
    high_quality: 'WJ',
    economy: 'EKO',
  },
  indexingMethod: {
    semantic_search: 'WEKTOR',
    full_text_search: 'PEŁNY TEKST',
    hybrid_search: 'HYBRYDOWY',
    invertedIndex: 'ODWRÓCONY',
  },
  mixtureHighQualityAndEconomicTip: 'Model ponownego rankingu jest wymagany dla mieszanki wysokiej jakości i ekonomicznych baz wiedzy.',
  inconsistentEmbeddingModelTip: 'Model ponownego rankingu jest wymagany, jeśli modele osadzania wybranych baz wiedzy są niespójne.',
  retrievalSettings: 'Ustawienia wyszukiwania',
  rerankSettings: 'Ustawienia ponownego rankingu',
  weightedScore: {
    title: 'Ważona ocena',
    description: 'Poprzez dostosowanie przypisanych wag, ta strategia ponownego rankingu określa, czy priorytetowo traktować dopasowanie semantyczne czy słów kluczowych.',
    semanticFirst: 'Najpierw semantyczne',
    keywordFirst: 'Najpierw słowa kluczowe',
    customized: 'Dostosowane',
    semantic: 'Semantyczne',
    keyword: 'Słowo kluczowe',
  },
  nTo1RetrievalLegacy: 'Wyszukiwanie N-do-1 zostanie oficjalnie wycofane od września. Zaleca się korzystanie z najnowszego wyszukiwania wielościeżkowego, aby uzyskać lepsze wyniki.',
  nTo1RetrievalLegacyLink: 'Dowiedz się więcej',
  nTo1RetrievalLegacyLinkText: 'Wyszukiwanie N-do-1 zostanie oficjalnie wycofane we wrześniu.',
  defaultRetrievalTip: 'Pobieranie wielu ścieżek jest używane domyślnie. Wiedza jest pobierana z wielu baz wiedzy, a następnie ponownie klasyfikowana.',
}

export default translation
