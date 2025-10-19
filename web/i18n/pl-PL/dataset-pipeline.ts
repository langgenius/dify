const translation = {
  creation: {
    createFromScratch: {
      title: 'Pusty potok wiedzy',
      description: 'Utwórz niestandardowy potok od podstaw z pełną kontrolą nad przetwarzaniem i strukturą danych.',
    },
    caution: 'Ostrożność',
    backToKnowledge: 'Powrót do wiedzy',
    importDSL: 'Importowanie z pliku DSL',
    createKnowledge: 'Tworzenie wiedzy',
    successTip: 'Pomyślnie utworzono bazę wiedzy',
    errorTip: 'Nie można utworzyć bazy wiedzy',
  },
  templates: {
    customized: 'Dostosowane',
  },
  operations: {
    details: 'Szczegóły',
    preview: 'Prapremiera',
    convert: 'Nawrócić',
    choose: 'Wybierać',
    process: 'Proces',
    dataSource: 'Źródło danych',
    editInfo: 'Edytowanie informacji',
    useTemplate: 'Korzystanie z tego potoku wiedzy',
    exportPipeline: 'Potok eksportu',
    backToDataSource: 'Powrót do źródła danych',
    saveAndProcess: 'Zapisywanie i przetwarzanie',
  },
  deletePipeline: {
    title: 'Czy na pewno chcesz usunąć ten szablon potoku?',
    content: 'Usunięcie szablonu potoku jest nieodwracalne.',
  },
  publishPipeline: {
    success: {
      message: 'Opublikowano potok wiedzy',
    },
    error: {
      message: 'Nie można opublikować potoku wiedzy',
    },
  },
  publishTemplate: {
    success: {
      learnMore: 'Dowiedz się więcej',
      tip: 'Możesz użyć tego szablonu na stronie tworzenia.',
      message: 'Opublikowano szablon potoku',
    },
    error: {
      message: 'Nie można opublikować szablonu potoku',
    },
  },
  exportDSL: {
    errorTip: 'Nie można wyeksportować DSL potoku',
    successTip: 'Pomyślnie wyeksportowano potok DSL',
  },
  details: {
    structure: 'Struktura',
    structureTooltip: 'Struktura fragmentów określa sposób dzielenia i indeksowania dokumentów — oferując tryby Ogólne, Nadrzędny-Podrzędny oraz Q&A — i jest unikatowa dla każdej bazy wiedzy.',
  },
  testRun: {
    steps: {
      documentProcessing: 'Przetwarzanie dokumentów',
      dataSource: 'Źródło danych',
    },
    dataSource: {
      localFiles: 'Pliki lokalne',
    },
    notion: {
      title: 'Wybierz strony Notion',
      docTitle: 'Dokumenty Notion',
    },
    title: 'Uruchomienie testowe',
    tooltip: 'W trybie uruchamiania testowego można importować tylko jeden dokument naraz w celu łatwiejszego debugowania i obserwacji.',
  },
  inputFieldPanel: {
    uniqueInputs: {
      title: 'Unikalne wejścia dla każdego wejścia',
      tooltip: 'Unikatowe dane wejściowe są dostępne tylko dla wybranego źródła danych i jego węzłów podrzędnych. Użytkownicy nie będą musieli go wypełniać podczas wybierania innych źródeł danych. W pierwszym kroku (Źródło danych) pojawią się tylko pola wejściowe, do których odwołują się zmienne źródła danych. Wszystkie inne pola zostaną wyświetlone w drugim kroku (Dokumenty procesowe).',
    },
    globalInputs: {
      title: 'Globalne dane wejściowe dla wszystkich wejść',
      tooltip: 'Globalne dane wejściowe są współdzielone we wszystkich węzłach. Użytkownicy będą musieli je wypełnić podczas wybierania dowolnego źródła danych. Na przykład pola, takie jak ogranicznik i maksymalna długość fragmentu, mogą być jednolicie stosowane w wielu źródłach danych. W pierwszym kroku (Źródło danych) pojawiają się tylko pola wejściowe, do których odwołują się zmienne źródła danych. Wszystkie inne pola pojawiają się w drugim kroku (Dokumenty procesowe).',
    },
    preview: {
      stepOneTitle: 'Źródło danych',
      stepTwoTitle: 'Dokumenty procesowe',
    },
    error: {
      variableDuplicate: 'Nazwa zmiennej już istnieje. Wybierz inną nazwę.',
    },
    editInputField: 'Edytuj pole wejściowe',
    addInputField: 'Dodaj pole wejściowe',
    title: 'Pola wprowadzania danych przez użytkownika',
    description: 'Pola wejściowe użytkownika służą do definiowania i zbierania zmiennych wymaganych podczas procesu wykonywania potoku. Użytkownicy mogą dostosować typ pola i elastycznie konfigurować wartość wejściową, aby spełnić potrzeby różnych źródeł danych lub etapów przetwarzania dokumentów.',
  },
  addDocuments: {
    steps: {
      processDocuments: 'Dokumenty procesowe',
      chooseDatasource: 'Wybieranie źródła danych',
      processingDocuments: 'Przetwarzanie dokumentów',
    },
    stepOne: {
      preview: 'Prapremiera',
    },
    stepTwo: {
      chunkSettings: 'Ustawienia porcji',
      previewChunks: 'Podgląd fragmentów',
    },
    stepThree: {
      learnMore: 'Dowiedz się więcej',
    },
    backToDataSource: 'Źródło danych',
    characters: 'Znaków',
    title: 'Dodawanie dokumentów',
  },
  documentSettings: {
    title: 'Ustawienia dokumentu',
  },
  onlineDocument: {},
  onlineDrive: {
    breadcrumbs: {
      searchPlaceholder: 'Szukaj w plikach...',
      allFiles: 'Wszystkie pliki',
      allBuckets: 'Wszystkie zasobniki pamięci masowej w chmurze',
    },
    resetKeywords: 'Resetowanie słów kluczowych',
    emptySearchResult: 'Nie znaleziono żadnych przedmiotów',
    notSupportedFileType: 'Ten typ pliku nie jest obsługiwany',
    emptyFolder: 'Ten folder jest pusty',
  },
  credentialSelector: {},
  conversion: {
    confirm: {
      title: 'Potwierdzenie',
      content: 'To działanie jest trwałe. Nie będzie można powrócić do poprzedniej metody. Potwierdź, aby przekonwertować.',
    },
    warning: 'Tej czynności nie można cofnąć.',
    errorMessage: 'Nie można przekonwertować zestawu danych na potok',
    descriptionChunk1: 'Teraz możesz przekonwertować istniejącą bazę wiedzy tak, aby używała potoku wiedzy do przetwarzania dokumentów',
    successMessage: 'Pomyślnie przekonwertowano zestaw danych na potok',
    title: 'Konwertuj na potok wiedzy',
    descriptionChunk2: '— bardziej otwarte i elastyczne podejście z dostępem do wtyczek z naszego rynku. Spowoduje to zastosowanie nowej metody przetwarzania do wszystkich przyszłych dokumentów.',
  },
  knowledgePermissions: 'Uprawnienia',
  knowledgeNameAndIcon: 'Nazwa i ikona wiedzy',
  inputField: 'Pole wejściowe',
  knowledgeDescription: 'Opis wiedzy',
  pipelineNameAndIcon: 'Nazwa i ikona potoku',
  knowledgeNameAndIconPlaceholder: 'Podaj nazwę Bazy Wiedzy',
  editPipelineInfo: 'Edytowanie informacji o potoku',
  knowledgeDescriptionPlaceholder: 'Opisz, co znajduje się w tej Bazie wiedzy. Szczegółowy opis umożliwia sztucznej inteligencji dokładniejszy dostęp do zawartości zestawu danych. Jeśli pole jest puste, Dify użyje domyślnej strategii trafień. (Opcjonalnie)',
}

export default translation
