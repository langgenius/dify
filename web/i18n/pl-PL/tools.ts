const translation = {
  title: 'Narzędzia',
  createCustomTool: 'Utwórz niestandardowe narzędzie',
  type: {
    all: 'Wszystkie',
    builtIn: 'Wbudowane',
    custom: 'Niestandardowe',
  },
  contribute: {
    line1: 'Interesuje mnie ',
    line2: 'współtworzenie narzędzi dla Dify.',
    viewGuide: 'Zobacz przewodnik',
  },
  author: 'Przez',
  auth: {
    unauthorized: 'Autoryzacja',
    authorized: 'Zautoryzowane',
    setup: 'Skonfiguruj autoryzację aby użyć',
    setupModalTitle: 'Konfiguruj autoryzację',
    setupModalTitleDescription:
      'Po skonfigurowaniu poświadczeń wszyscy członkowie w przestrzeni roboczej mogą używać tego narzędzia podczas projektowania aplikacji.',
  },
  includeToolNum: '{{num}} narzędzi zawarte',
  addTool: 'Dodaj narzędzie',
  createTool: {
    title: 'Utwórz niestandardowe narzędzie',
    editAction: 'Konfiguruj',
    editTitle: 'Edytuj niestandardowe narzędzie',
    name: 'Nazwa',
    toolNamePlaceHolder: 'Wprowadź nazwę narzędzia',
    schema: 'Schemat',
    schemaPlaceHolder: 'Wprowadź tutaj swój schemat OpenAPI',
    viewSchemaSpec: 'Zobacz specyfikację OpenAPI-Swagger',
    importFromUrl: 'Importuj z adresu URL',
    importFromUrlPlaceHolder: 'https://...',
    urlError: 'Proszę podać prawidłowy URL',
    examples: 'Przykłady',
    exampleOptions: {
      json: 'Pogoda (JSON)',
      yaml: 'Sklep Zoologiczny (YAML)',
      blankTemplate: 'Pusty szablon',
    },
    availableTools: {
      title: 'Dostępne narzędzia',
      name: 'Nazwa',
      description: 'Opis',
      method: 'Metoda',
      path: 'Ścieżka',
      action: 'Akcje',
      test: 'Test',
    },
    authMethod: {
      title: 'Metoda autoryzacji',
      type: 'Typ autoryzacji',
      keyTooltip:
        'Klucz nagłówka HTTP, Możesz pozostawić go z "Autoryzacja" jeśli nie wiesz co to jest lub ustaw go na niestandardową wartość',
      types: {
        none: 'Brak',
        api_key: 'Klucz API',
        apiKeyPlaceholder: 'Nazwa nagłówka HTTP dla Klucza API',
        apiValuePlaceholder: 'Wprowadź Klucz API',
      },
      key: 'Klucz',
      value: 'Wartość',
    },
    authHeaderPrefix: {
      title: 'Typ autoryzacji',
      types: {
        basic: 'Podstawowa',
        bearer: 'Bearer',
        custom: 'Niestandardowa',
      },
    },
    privacyPolicy: 'Polityka prywatności',
    privacyPolicyPlaceholder: 'Proszę wprowadzić politykę prywatności',
  },
  test: {
    title: 'Test',
    parametersValue: 'Parametry i Wartość',
    parameters: 'Parametry',
    value: 'Wartość',
    testResult: 'Wyniki testu',
    testResultPlaceholder: 'Wynik testu pojawi się tutaj',
  },
  thought: {
    using: 'Używanie',
    used: 'Użyty',
    requestTitle: 'Żądanie do',
    responseTitle: 'Odpowiedź od',
  },
  setBuiltInTools: {
    info: 'Informacje',
    setting: 'Ustawienia',
    toolDescription: 'Opis narzędzia',
    parameters: 'parametry',
    string: 'ciąg znaków',
    number: 'liczba',
    required: 'Wymagane',
    infoAndSetting: 'Informacje i Ustawienia',
  },
  noCustomTool: {
    title: 'Brak niestandardowych narzędzi!',
    content:
      'Dodaj i zarządzaj niestandardowymi narzędziami tutaj, aby budować aplikacje AI.',
    createTool: 'Utwórz Narzędzie',
  },
  noSearchRes: {
    title: 'Przykro nam, brak wyników!',
    content:
      'Nie znaleźliśmy żadnych narzędzi pasujących do Twojego wyszukiwania.',
    reset: 'Resetuj Wyszukiwanie',
  },
  builtInPromptTitle: 'Komunikat',
  toolRemoved: 'Narzędzie usunięte',
  notAuthorized: 'Narzędzie nieautoryzowane',
  howToGet: 'Jak uzyskać',
}

export default translation
