const translation = {
  pageTitle: {
    line1: 'MONIT',
    line2: 'Inżynieria',
  },
  orchestrate: 'Orkiestracja',
  promptMode: {
    simple: 'Przełącz na tryb Ekspert, aby edytować cały MONIT',
    advanced: 'Tryb Ekspert',
    switchBack: 'Przełącz z powrotem',
    advancedWarning: {
      title:
        'Przełączyłeś się na Tryb Ekspert, i po modyfikacji MONITU, NIE można powrócić do trybu podstawowego.',
      description: 'W Trybie Ekspert, możesz edytować cały MONIT.',
      learnMore: 'Dowiedz się więcej',
      ok: 'OK',
    },
    operation: {
      addMessage: 'Dodaj Wiadomość',
    },
    contextMissing:
      'Brak komponentu kontekstowego, skuteczność monitu może być niewystarczająca.',
  },
  operation: {
    applyConfig: 'Publikuj',
    resetConfig: 'Resetuj',
    debugConfig: 'Debuguj',
    addFeature: 'Dodaj funkcję',
    automatic: 'Automatyczny',
    stopResponding: 'Przestaje odpowiadać',
    agree: 'lubię',
    disagree: 'nie lubię',
    cancelAgree: 'Anuluj polubienie',
    cancelDisagree: 'Anuluj niepolubienie',
    userAction: 'Akcja użytkownika ',
  },
  notSetAPIKey: {
    title: 'Klucz dostawcy LLM nie został ustawiony',
    trailFinished: 'Ścieżka zakończona',
    description:
      'Klucz dostawcy LLM nie został ustawiony, musi zostać ustawiony przed debugowaniem.',
    settingBtn: 'Przejdź do ustawień',
  },
  trailUseGPT4Info: {
    title: 'Obecnie nie obsługuje GPT-4',
    description: 'Użyj GPT-4, proszę ustawić klucz API.',
  },
  feature: {
    groupChat: {
      title: 'Rozmowy grupowe',
      description:
        'Dodanie ustawień przedkonwersacyjnych dla aplikacji może poprawić doświadczenia użytkownika.',
    },
    groupExperience: {
      title: 'Poprawa doświadczenia',
    },
    conversationOpener: {
      title: 'Otwieracze do rozmów',
      description:
        'W aplikacji czatowej pierwsze zdanie, które AI aktywnie wypowiada do użytkownika, zazwyczaj służy jako powitanie.',
    },
    suggestedQuestionsAfterAnswer: {
      title: 'Nawiązanie',
      description: 'Ustawienie kolejnych pytań może poprawić czat.',
      resDes: '3 sugestie dla kolejnego pytania użytkownika.',
      tryToAsk: 'Spróbuj zapytać',
    },
    moreLikeThis: {
      title: 'Więcej takich jak ten',
      description:
        'Generuj wiele tekstów na raz, a następnie edytuj i kontynuuj generowanie',
      generateNumTip: 'Liczba generowanych razów',
      tip: 'Korzystanie z tej funkcji spowoduje dodatkowe zużycie tokenów',
    },
    speechToText: {
      title: 'Mowa na tekst',
      description: 'Po włączeniu można używać wprowadzania głosowego.',
      resDes: 'Wprowadzanie głosowe jest włączone',
    },
    textToSpeech: {
      title: 'Tekst na mowę',
      description: 'Po włączeniu tekst można przekształcić w mowę.',
      resDes: 'Tekst na audio jest włączony',
    },
    citation: {
      title: 'Cytaty i odniesienia',
      description:
        'Po włączeniu, pokaż dokument źródłowy i przypisaną sekcję wygenerowanej treści.',
      resDes: 'Cytaty i odniesienia są włączone',
    },
    annotation: {
      title: 'Odpowiedź z adnotacją',
      description:
        'Możesz ręcznie dodać odpowiedź wysokiej jakości do pamięci podręcznej dla priorytetowego dopasowania do podobnych pytań użytkownika.',
      resDes: 'Odpowiedź z adnotacją jest włączona',
      scoreThreshold: {
        title: 'Próg wyników',
        description:
          'Służy do ustawienia progu podobieństwa dla odpowiedzi z adnotacją.',
        easyMatch: 'Łatwe dopasowanie',
        accurateMatch: 'Dokładne dopasowanie',
      },
      matchVariable: {
        title: 'Zmienna dopasowania',
        choosePlaceholder: 'Wybierz zmienną do dopasowania',
      },
      cacheManagement: 'Adnotacje',
      cached: 'Zanotowano',
      remove: 'Usuń',
      removeConfirm: 'Usunąć tę adnotację?',
      add: 'Dodaj adnotację',
      edit: 'Edytuj adnotację',
    },
    dataSet: {
      title: 'Kontekst',
      noData: 'Możesz importować wiedzę jako kontekst',
      words: 'Słowa',
      textBlocks: 'Bloki tekstu',
      selectTitle: 'Wybierz odniesienie do wiedzy',
      selected: 'Wiedza wybrana',
      noDataSet: 'Nie znaleziono wiedzy',
      toCreate: 'Przejdź do tworzenia',
      notSupportSelectMulti: 'Obecnie obsługiwana jest tylko jedna wiedza',
      queryVariable: {
        title: 'Zmienna zapytania',
        tip: 'Ta zmienna będzie używana jako dane wejściowe zapytania do odzyskiwania kontekstu, uzyskując informacje kontekstowe związane z wprowadzonymi danymi.',
        choosePlaceholder: 'Wybierz zmienną zapytania',
        noVar: 'Brak zmiennych',
        noVarTip: 'proszę stworzyć zmienną w sekcji Zmienne',
        unableToQueryDataSet: 'Nie można odzyskać wiedzy',
        unableToQueryDataSetTip:
          'Nie udało się pomyślnie odzyskać wiedzy, proszę wybrać zmienną zapytania kontekstowego w sekcji kontekstowej.',
        ok: 'OK',
        contextVarNotEmpty:
          'zmienna zapytania kontekstowego nie może być pusta',
        deleteContextVarTitle: 'Usunąć zmienną „{{varName}}”?',
        deleteContextVarTip:
          'Ta zmienna została ustawiona jako zmienna zapytania kontekstowego, a jej usunięcie wpłynie na normalne korzystanie z wiedzy. Jeśli nadal potrzebujesz jej usunąć, wybierz ją ponownie w sekcji kontekstowej.',
      },
    },
    tools: {
      title: 'Narzędzia',
      tips: 'Narzędzia zapewniają standardową metodę wywołania API, przyjmując dane wejściowe użytkownika lub zmienne jako parametry żądania do zapytania o dane zewnętrzne jako kontekst.',
      toolsInUse: '{{count}} narzędzi w użyciu',
      modal: {
        title: 'Narzędzie',
        toolType: {
          title: 'Typ narzędzia',
          placeholder: 'Wybierz typ narzędzia',
        },
        name: {
          title: 'Nazwa',
          placeholder: 'Wprowadź nazwę',
        },
        variableName: {
          title: 'Nazwa zmiennej',
          placeholder: 'Wprowadź nazwę zmiennej',
        },
      },
    },
    conversationHistory: {
      title: 'Historia konwersacji',
      description: 'Ustaw prefixy dla ról w rozmowie',
      tip: 'Historia konwersacji nie jest włączona, proszę dodać <historie> w monicie powyżej.',
      learnMore: 'Dowiedz się więcej',
      editModal: {
        title: 'Edycja nazw ról konwersacyjnych',
        userPrefix: 'Prefix użytkownika',
        assistantPrefix: 'Prefix asystenta',
      },
    },
    toolbox: {
      title: 'SKRZYNKA NARZĘDZIOWA',
    },
    moderation: {
      title: 'Moderacja treści',
      description:
        'Zabezpiecz wyjście modelu, używając API moderacji lub utrzymując listę wrażliwych słów.',
      allEnabled: 'Treść WEJŚCIOWA/WYJŚCIOWA Włączona',
      inputEnabled: 'Treść WEJŚCIOWA Włączona',
      outputEnabled: 'Treść WYJŚCIOWA Włączona',
      modal: {
        title: 'Ustawienia moderacji treści',
        provider: {
          title: 'Dostawca',
          openai: 'Moderacja OpenAI',
          openaiTip: {
            prefix:
              'Moderacja OpenAI wymaga skonfigurowanego klucza API OpenAI w ',
            suffix: '.',
          },
          keywords: 'Słowa kluczowe',
        },
        keywords: {
          tip: 'Po jednym w wierszu, oddzielone znakiem nowej linii. Maksymalnie 100 znaków na wiersz.',
          placeholder: 'Po jednym w wierszu, oddzielone znakiem nowej linii',
          line: 'Linia',
        },
        content: {
          input: 'Moderuj treść WEJŚCIOWĄ',
          output: 'Moderuj treść WYJŚCIOWĄ',
          preset: 'Ustawione odpowiedzi',
          placeholder: 'Tutaj wprowadź ustawione odpowiedzi',
          condition:
            'Treść WEJŚCIA i WYJŚCIA musi być włączona przynajmniej jedna',
          fromApi: 'Ustawione odpowiedzi zwracane przez API',
          errorMessage: 'Ustawione odpowiedzi nie mogą być puste',
          supportMarkdown: 'Obsługuje Markdown',
        },
        openaiNotConfig: {
          before:
            'Moderacja OpenAI wymaga skonfigurowanego klucza API OpenAI w',
          after: '',
        },
      },
    },
  },
  automatic: {
    title: 'Zautomatyzowana orkiestracja aplikacji',
    description:
      'Opisz swój scenariusz, Dify zorkiestruje aplikację dla Ciebie.',
    intendedAudience: 'Dla kogo jest przeznaczona ta aplikacja?',
    intendedAudiencePlaceHolder: 'np. Uczeń',
    solveProblem:
      'Jakie problemy mają nadzieję, że AI może rozwiązać dla nich?',
    solveProblemPlaceHolder:
      'np. Wyciąganie wniosków i podsumowanie informacji z długich raportów i artykułów',
    generate: 'Generuj',
    audiencesRequired: 'Wymagana publiczności',
    problemRequired: 'Wymagany problem',
    resTitle: 'Stworzyliśmy następującą aplikację dla Ciebie.',
    apply: 'Zastosuj tę orkiestrację',
    noData:
      'Opisz swój przypadek po lewej, podgląd orkiestracji pojawi się tutaj.',
    loading: 'Orkiestracja aplikacji dla Ciebie...',
    overwriteTitle: 'Zastąpić istniejącą konfigurację?',
    overwriteMessage:
      'Zastosowanie tej orkiestracji zastąpi istniejącą konfigurację.',
  },
  resetConfig: {
    title: 'Potwierdź reset?',
    message:
      'Reset odrzuca zmiany, przywracając ostatnią opublikowaną konfigurację.',
  },
  errorMessage: {
    nameOfKeyRequired: 'nazwa klucza: {{key}} wymagana',
    valueOfVarRequired: '{{key}} wartość nie może być pusta',
    queryRequired: 'Tekst żądania jest wymagany.',
    waitForResponse: 'Proszę czekać na odpowiedź na poprzednią wiadomość.',
    waitForBatchResponse: 'Proszę czekać na odpowiedź na zadanie wsadowe.',
    notSelectModel: 'Proszę wybrać model',
    waitForImgUpload: 'Proszę czekać na przesłanie obrazu',
  },
  chatSubTitle: 'Instrukcje',
  completionSubTitle: 'Prefix Monitu',
  promptTip:
    'Monity kierują odpowiedziami AI za pomocą instrukcji i ograniczeń. Wstaw zmienne takie jak {{input}}. Ten monit nie będzie widoczny dla użytkowników.',
  formattingChangedTitle: 'Zmiana formatowania',
  formattingChangedText:
    'Modyfikacja formatowania zresetuje obszar debugowania, czy jesteś pewien?',
  variableTitle: 'Zmienne',
  variableTip:
    'Użytkownicy wypełniają zmienne w formularzu, automatycznie zastępując zmienne w monicie.',
  notSetVar:
    'Zmienne pozwalają użytkownikom wprowadzać słowa wstępujące lub otwierające uwagi podczas wypełniania formularzy. Możesz spróbować wpisać "{{input}}" w słowach monitu.',
  autoAddVar:
    'Niezdefiniowane zmienne odwołują się w pre-monicie, czy chcesz je dodać do formularza wejściowego użytkownika?',
  variableTable: {
    key: 'Klucz Zmiennej',
    name: 'Nazwa Pola Wejściowego Użytkownika',
    optional: 'Opcjonalnie',
    type: 'Typ Wejścia',
    action: 'Akcje',
    typeString: 'String',
    typeSelect: 'Wybierz',
  },
  varKeyError: {
    canNoBeEmpty: '{{klucz}} jest wymagany',
    tooLong:
      '{{key}} za długi. Nie może być dłuższy niż 30 znaków',
    notValid:
      '{{key}} jest nieprawidłowy. Może zawierać tylko litery, cyfry i podkreślenia',
    notStartWithNumber:
      '{{key}} nie może zaczynać się od cyfry',
    keyAlreadyExists: '{{key}} już istnieje',
  },
  otherError: {
    promptNoBeEmpty: 'Monit nie może być pusty',
    historyNoBeEmpty: 'Historia konwersacji musi być ustawiona w monicie',
    queryNoBeEmpty: 'Zapytanie musi być ustawione w monicie',
  },
  variableConfig: {
    'addModalTitle': 'Dodaj Pole Wejściowe',
    'editModalTitle': 'Edytuj Pole Wejściowe',
    'description': 'Ustawienia dla zmiennej {{varName}}',
    'fieldType': 'Typ pola',
    'string': 'Krótki tekst',
    'text-input': 'Krótki tekst',
    'paragraph': 'Akapit',
    'select': 'Wybierz',
    'number': 'Numer',
    'notSet': 'Nie ustawione, spróbuj wpisać {{input}} w monicie wstępnym',
    'stringTitle': 'Opcje pola tekstowego formularza',
    'maxLength': 'Maksymalna długość',
    'options': 'Opcje',
    'addOption': 'Dodaj opcję',
    'apiBasedVar': 'Zmienna oparta na API',
    'varName': 'Nazwa zmiennej',
    'labelName': 'Nazwa etykiety',
    'inputPlaceholder': 'Proszę wpisać',
    'required': 'Wymagane',
    'errorMsg': {
      varNameRequired: 'Wymagana nazwa zmiennej',
      labelNameRequired: 'Wymagana nazwa etykiety',
      varNameCanBeRepeat: 'Nazwa zmiennej nie może się powtarzać',
      atLeastOneOption: 'Wymagana jest co najmniej jedna opcja',
      optionRepeat: 'Powtarzają się opcje',
    },
  },
  vision: {
    name: 'Wizja',
    description:
      'Włączenie Wizji pozwoli modelowi przyjmować obrazy i odpowiadać na pytania o nich.',
    settings: 'Ustawienia',
    visionSettings: {
      title: 'Ustawienia Wizji',
      resolution: 'Rozdzielczość',
      resolutionTooltip: `niska rozdzielczość pozwoli modelowi odbierać obrazy o rozdzielczości 512 x 512 i reprezentować obraz z limitem 65 tokenów. Pozwala to API na szybsze odpowiedzi i zużywa mniej tokenów wejściowych dla przypadków, które nie wymagają wysokiego szczegółu.
        \n
        wysoka rozdzielczość pozwala najpierw modelowi zobaczyć obraz niskiej rozdzielczości, a następnie tworzy szczegółowe przycięcia obrazów wejściowych jako 512px kwadratów w oparciu o rozmiar obrazu wejściowego. Każde z tych szczegółowych przycięć używa dwukrotności budżetu tokenów, co daje razem 129 tokenów.`,
      high: 'Wysoka',
      low: 'Niska',
      uploadMethod: 'Metoda przesyłania',
      both: 'Obie',
      localUpload: 'Przesyłanie lokalne',
      url: 'URL',
      uploadLimit: 'Limit przesyłania',
    },
  },
  voice: {
    name: 'Głos',
    defaultDisplay: 'Domyślny Głos',
    description: 'Ustawienia głosu tekstu na mowę',
    settings: 'Ustawienia',
    voiceSettings: {
      title: 'Ustawienia Głosu',
      language: 'Język',
      resolutionTooltip: 'Wsparcie językowe głosu tekstu na mowę.',
      voice: 'Głos',
      autoPlay: 'Automatyczne odtwarzanie',
      autoPlayEnabled: 'włączyć coś',
      autoPlayDisabled: 'zamknięcie',
    },
  },
  openingStatement: {
    title: 'Wstęp do rozmowy',
    add: 'Dodaj',
    writeOpener: 'Napisz wstęp',
    placeholder:
      'Tutaj napisz swoją wiadomość wprowadzającą, możesz użyć zmiennych, spróbuj wpisać {{variable}}.',
    openingQuestion: 'Pytania otwierające',
    noDataPlaceHolder:
      'Rozpoczynanie rozmowy z użytkownikiem może pomóc AI nawiązać bliższe połączenie z nim w aplikacjach konwersacyjnych.',
    varTip: 'Możesz używać zmiennych, spróbuj wpisać {{variable}}',
    tooShort:
      'Wymagane jest co najmniej 20 słów wstępnego monitu, aby wygenerować uwagi wstępne do rozmowy.',
    notIncludeKey:
      'Wstępny monit nie zawiera zmiennej: {{key}}. Proszę dodać ją do wstępnego monitu.',
  },
  modelConfig: {
    model: 'Model',
    setTone: 'Ustaw ton odpowiedzi',
    title: 'Model i parametry',
    modeType: {
      chat: 'Czat',
      completion: 'Uzupełnienie',
    },
  },
  inputs: {
    title: 'Debugowanie i podgląd',
    noPrompt: 'Spróbuj wpisać jakiś monit w polu przedmonitu',
    userInputField: 'Pole wejściowe użytkownika',
    noVar:
      'Wypełnij wartość zmiennej, która będzie automatycznie zastępowana w monicie za każdym razem, gdy rozpocznie się nowa sesja.',
    chatVarTip:
      'Wypełnij wartość zmiennej, która będzie automatycznie zastępowana w monicie za każdym razem, gdy rozpocznie się nowa sesja',
    completionVarTip:
      'Wypełnij wartość zmiennej, która będzie automatycznie zastępowana w słowach monitu za każdym razem, gdy zostanie przesłane pytanie.',
    previewTitle: 'Podgląd monitu',
    queryTitle: 'Treść zapytania',
    queryPlaceholder: 'Proszę wprowadzić tekst żądania.',
    run: 'URUCHOM',
  },
  result: 'Tekst wyjściowy',
  datasetConfig: {
    settingTitle: 'Ustawienia odzyskiwania',
    knowledgeTip: 'Kliknij przycisk „+”, aby dodać wiedzę',
    retrieveOneWay: {
      title: 'Odzyskiwanie N-do-1',
      description:
        'Na podstawie zamiaru użytkownika i opisów Wiedzy, Agent samodzielnie wybiera najlepszą Wiedzę do zapytania. Najlepiej sprawdza się w aplikacjach o wyraźnej, ograniczonej Wiedzy.',
    },
    retrieveMultiWay: {
      title: 'Odzyskiwanie wielościeżkowe',
      description:
        'Na podstawie zamiaru użytkownika, zapytania obejmują wszystkie Wiedze, pobierają odpowiedni tekst z wielu źródeł i wybierają najlepsze wyniki dopasowane do zapytań użytkownika po ponownym rankingu. Wymagana jest konfiguracja API modelu Przerankowania.',
    },
    rerankModelRequired: 'Wymagany model Przerankowania',
    params: 'Parametry',
    top_k: 'Najlepsze K',
    top_kTip:
      'Używane do filtrowania fragmentów najbardziej podobnych do pytań użytkownika. System również dynamicznie dostosowuje wartość Najlepszych K, zgodnie z maksymalną liczbą tokenów wybranego modelu.',
    score_threshold: 'Próg punktacji',
    score_thresholdTip:
      'Używany do ustawienia progu podobieństwa dla filtrowania fragmentów.',
    retrieveChangeTip:
      'Modyfikacja trybu indeksowania i odzyskiwania może wpłynąć na aplikacje powiązane z tą Wiedzą.',
  },
  debugAsSingleModel: 'Debuguj jako pojedynczy model',
  debugAsMultipleModel: 'Debuguj jako wiele modeli',
  duplicateModel: 'Duplikuj',
  publishAs: 'Opublikuj jako',
  assistantType: {
    name: 'Typ asystenta',
    chatAssistant: {
      name: 'Podstawowy Asystent',
      description:
        'Buduj asystenta opartego na czacie, korzystając z dużego modelu językowego',
    },
    agentAssistant: {
      name: 'Asystent Agent',
      description:
        'Buduj inteligentnego agenta, który może autonomicznie wybierać narzędzia do wykonywania zadań',
    },
  },
  agent: {
    agentMode: 'Tryb Agenta',
    agentModeDes: 'Ustaw rodzaj trybu wnioskowania dla agenta',
    agentModeType: {
      ReACT: 'ReAct',
      functionCall: 'Wywołanie funkcji',
    },
    setting: {
      name: 'Ustawienia Agenta',
      description:
        'Ustawienia Asystenta Agenta pozwalają ustawić tryb agenta i zaawansowane funkcje, takie jak wbudowane monity, dostępne tylko w typie Agent.',
      maximumIterations: {
        name: 'Maksymalna liczba iteracji',
        description:
          'Ogranicz liczbę iteracji, które asystent agenta może wykonać',
      },
    },
    buildInPrompt: 'Wbudowany Monit',
    firstPrompt: 'Pierwszy Monit',
    nextIteration: 'Następna Iteracja',
    promptPlaceholder: 'Napisz tutaj swój monit',
    tools: {
      name: 'Narzędzia',
      description:
        'Używanie narzędzi może rozszerzyć możliwości LLM, takie jak wyszukiwanie w internecie lub wykonywanie obliczeń naukowych',
      enabled: 'Włączone',
    },
  },
}

export default translation
