const translation = {
  subscription: {
    title: 'Subskrypcje',
    listNum: 'subskrypcje {{num}}',
    empty: {
      title: 'Brak subskrypcji',
      button: 'Nowa subskrypcja',
    },
    createButton: {
      oauth: 'Nowa subskrypcja z OAuth',
      apiKey: 'Nowa subskrypcja z kluczem API',
      manual: 'Wklej adres URL, aby utworzyć nową subskrypcję',
    },
    createSuccess: 'Subskrypcja została pomyślnie utworzona',
    createFailed: 'Nie udało się utworzyć subskrypcji',
    maxCount: 'Maksymalnie {{num}} subskrypcji',
    selectPlaceholder: 'Wybierz subskrypcję',
    noSubscriptionSelected: 'Nie wybrano subskrypcji',
    subscriptionRemoved: 'Subskrypcja usunięta',
    list: {
      title: 'Subskrypcje',
      addButton: 'Dodaj',
      tip: 'Odbieraj zdarzenia poprzez subskrypcję',
      item: {
        enabled: 'Włączone',
        disabled: 'Niepełnosprawny',
        credentialType: {
          api_key: 'Klucz API',
          oauth2: 'OAuth',
          unauthorized: 'Instrukcja',
        },
        actions: {
          delete: 'Usuń',
          deleteConfirm: {
            title: 'Usunąć {{name}}?',
            success: 'Subskrypcja {{name}} została pomyślnie usunięta',
            error: 'Nie udało się usunąć subskrypcji {{name}}',
            content: 'Po usunięciu, tej subskrypcji nie da się odzyskać. Proszę potwierdzić.',
            contentWithApps: 'Aktualna subskrypcja jest wykorzystywana przez {{count}} aplikacji. Usunięcie jej spowoduje, że skonfigurowane aplikacje przestaną otrzymywać zdarzenia subskrypcji.',
            confirm: 'Potwierdź usunięcie',
            cancel: 'Anuluj',
            confirmInputWarning: 'Proszę wpisać poprawną nazwę, aby potwierdzić.',
            confirmInputPlaceholder: 'Wprowadź "{{name}}", aby potwierdzić.',
            confirmInputTip: 'Proszę wpisać „{{name}}”, aby potwierdzić.',
          },
        },
        status: {
          active: 'Aktywny',
          inactive: 'Nieaktywny',
        },
        usedByNum: 'Używane przez {{num}} przepływy pracy',
        noUsed: 'Nie użyto przepływu pracy',
      },
    },
    addType: {
      title: 'Dodaj subskrypcję',
      description: 'Wybierz, jak chcesz utworzyć swoją subskrypcję wyzwalacza',
      options: {
        apikey: {
          title: 'Twórz z kluczem API',
          description: 'Automatyczne tworzenie subskrypcji przy użyciu danych uwierzytelniających API',
        },
        oauth: {
          title: 'Utwórz za pomocą OAuth',
          description: 'Autoryzuj za pomocą platformy zewnętrznej, aby utworzyć subskrypcję',
          clientSettings: 'Ustawienia klienta OAuth',
          clientTitle: 'Klient OAuth',
          default: 'Domyślny',
          custom: 'Niestandardowy',
        },
        manual: {
          title: 'Ręczna konfiguracja',
          description: 'Wklej adres URL, aby utworzyć nową subskrypcję',
          tip: 'Skonfiguruj adres URL na platformie zewnętrznej ręcznie',
        },
      },
    },
  },
  modal: {
    steps: {
      verify: 'Zweryfikuj',
      configuration: 'Konfiguracja',
    },
    common: {
      cancel: 'Anuluj',
      back: 'Wstecz',
      next: 'Dalej',
      create: 'Utwórz',
      verify: 'Zweryfikuj',
      authorize: 'Autoryzuj',
      creating: 'Tworzenie...',
      verifying: 'Weryfikacja...',
      authorizing: 'Autoryzacja...',
    },
    oauthRedirectInfo: 'Ponieważ nie znaleziono żadnych poufnych danych klienta systemu dla tego dostawcy narzędzi, konieczne jest ręczne skonfigurowanie. Dla redirect_uri proszę użyć',
    apiKey: {
      title: 'Twórz z kluczem API',
      verify: {
        title: 'Zweryfikuj poświadczenia',
        description: 'Proszę podać swoje dane uwierzytelniające API, aby zweryfikować dostęp',
        error: 'Weryfikacja poświadczeń nie powiodła się. Proszę sprawdzić swój klucz API.',
        success: 'Dane uwierzytelniające zostały pomyślnie zweryfikowane',
      },
      configuration: {
        title: 'Skonfiguruj subskrypcję',
        description: 'Skonfiguruj parametry subskrypcji',
      },
    },
    oauth: {
      title: 'Utwórz za pomocą OAuth',
      authorization: {
        title: 'Autoryzacja OAuth',
        description: 'Autoryzuj Dify, aby uzyskać dostęp do Twojego konta',
        redirectUrl: 'Przekieruj URL',
        redirectUrlHelp: 'Użyj tego adresu URL w konfiguracji swojej aplikacji OAuth',
        authorizeButton: 'Autoryzuj za pomocą {{provider}}',
        waitingAuth: 'Oczekiwanie na autoryzację...',
        authSuccess: 'Autoryzacja powiodła się',
        authFailed: 'Nie udało się pobrać informacji autoryzacyjnych OAuth',
        waitingJump: 'Autoryzowany, oczekujący na start',
      },
      configuration: {
        title: 'Skonfiguruj subskrypcję',
        description: 'Skonfiguruj parametry subskrypcji po autoryzacji',
        success: 'Konfiguracja OAuth zakończona powodzeniem',
        failed: 'Konfiguracja OAuth nie powiodła się',
      },
      remove: {
        success: 'Usunięcie OAuth powiodło się',
        failed: 'Usunięcie OAuth nie powiodło się',
      },
      save: {
        success: 'Konfiguracja OAuth została zapisana pomyślnie',
      },
    },
    manual: {
      title: 'Ręczna konfiguracja',
      description: 'Skonfiguruj subskrypcję webhooka ręcznie',
      logs: {
        title: 'Dzienniki żądań',
        request: 'Żądanie',
        loading: 'Oczekiwanie na żądanie od {{pluginName}}...',
      },
    },
    form: {
      subscriptionName: {
        label: 'Nazwa subskrypcji',
        placeholder: 'Wprowadź nazwę subskrypcji',
        required: 'Nazwa subskrypcji jest wymagana',
      },
      callbackUrl: {
        label: 'Adres URL zwrotny',
        description: 'Ten adres URL będzie odbierać zdarzenia webhook',
        tooltip: 'Udostępnij publicznie dostępny punkt końcowy, który może odbierać żądania wywołań zwrotnych od dostawcy wyzwalacza.',
        placeholder: 'Generowanie...',
        privateAddressWarning: 'Ten adres URL wydaje się być adresem wewnętrznym, co może spowodować niepowodzenie żądań webhook. Możesz zmienić TRIGGER_URL na adres publiczny.',
      },
    },
    errors: {
      createFailed: 'Nie udało się utworzyć subskrypcji',
      verifyFailed: 'Nie udało się zweryfikować danych uwierzytelniających',
      authFailed: 'Autoryzacja nie powiodła się',
      networkError: 'Błąd sieci, spróbuj ponownie',
    },
  },
  events: {
    title: 'Dostępne wydarzenia',
    description: 'Zdarzenia, na które ten wtyczka wyzwalacza może się subskrybować',
    empty: 'Brak dostępnych wydarzeń',
    event: 'Wydarzenie',
    events: 'Wydarzenia',
    actionNum: '{{num}} {{event}} WŁĄCZONE',
    item: {
      parameters: 'parametry {{count}}',
      noParameters: 'Brak parametrów',
    },
    output: 'Wynik',
  },
  node: {
    status: {
      warning: 'Rozłącz',
    },
  },
}

export default translation
