const translation = {
  title: 'Dzienniki',
  description:
    'Dzienniki rejestrują stan działania aplikacji, w tym dane wejściowe użytkowników i odpowiedzi AI.',
  dateTimeFormat: 'DD/MM/YYYY HH:mm',
  table: {
    header: {
      time: 'Czas',
      endUser: 'Użytkownik końcowy',
      input: 'Wejście',
      output: 'Wyjście',
      summary: 'Tytuł',
      messageCount: 'Liczba wiadomości',
      userRate: 'Ocena użytkownika',
      adminRate: 'Ocena operatora',
      startTime: 'CZAS STARTU',
      status: 'STATUS',
      runtime: 'CZAS DZIAŁANIA',
      tokens: 'TOKENY',
      user: 'UŻYTKOWNIK KOŃCOWY',
      version: 'WERSJA',
    },
    pagination: {
      previous: 'Poprzedni',
      next: 'Następny',
    },
    empty: {
      noChat: 'Brak rozmowy',
      noOutput: 'Brak wyników',
      element: {
        title: 'Czy ktoś jest?',
        content:
          'Obserwuj i adnotuj interakcje między użytkownikami końcowymi a aplikacjami AI tutaj, aby ciągle poprawiać dokładność AI. Możesz spróbować <shareLink>udostępnić</shareLink> lub <testLink>przetestować</testLink> aplikację internetową samodzielnie, a następnie wrócić na tę stronę.',
      },
    },
  },
  detail: {
    time: 'Czas',
    conversationId: 'ID rozmowy',
    promptTemplate: 'Szablon monitu',
    promptTemplateBeforeChat:
      'Szablon monitu przed rozmową · Jako wiadomość systemowa',
    annotationTip: 'Usprawnienia oznaczone przez {{user}}',
    timeConsuming: '',
    second: 's',
    tokenCost: 'Wydatkowane tokeny',
    loading: 'ładowanie',
    operation: {
      like: 'lubię',
      dislike: 'nie lubię',
      addAnnotation: 'Dodaj usprawnienie',
      editAnnotation: 'Edytuj usprawnienie',
      annotationPlaceholder:
        'Wprowadź oczekiwaną odpowiedź, którą chcesz, aby AI odpowiedziało, co może być używane do dokładnego dostrojenia modelu i ciągłej poprawy jakości generacji tekstu w przyszłości.',
    },
    variables: 'Zmienne',
    uploadImages: 'Przesłane obrazy',
  },
  filter: {
    period: {
      today: 'Dzisiaj',
      last7days: 'Ostatnie 7 dni',
      last4weeks: 'Ostatnie 4 tygodnie',
      last3months: 'Ostatnie 3 miesiące',
      last12months: 'Ostatnie 12 miesięcy',
      monthToDate: 'Od początku miesiąca',
      quarterToDate: 'Od początku kwartału',
      yearToDate: 'Od początku roku',
      allTime: 'Cały czas',
    },
    annotation: {
      all: 'Wszystkie',
      annotated: 'Zanotowane usprawnienia ({{count}} elementów)',
      not_annotated: 'Nie zanotowane',
    },
  },
  workflowTitle: 'Dzienniki przepływu pracy',
  workflowSubtitle: 'Dziennik zarejestrował operację Automatyzacji.',
  runDetail: {
    title: 'Dziennik rozmowy',
    workflowTitle: 'Szczegół dziennika',
  },
  promptLog: 'Dziennik monitów',
  agentLog: 'Dziennik agenta',
  viewLog: 'Zobacz dziennik',
  agentLogDetail: {
    agentMode: 'Tryb agenta',
    toolUsed: 'Użyte narzędzia',
    iterations: 'Iteracje',
    iteration: 'Iteracja',
    finalProcessing: 'Końcowa obróbka',
  },
}

export default translation
