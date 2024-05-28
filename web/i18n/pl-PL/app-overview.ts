const translation = {
  welcome: {
    firstStepTip: 'Aby rozpocząć,',
    enterKeyTip: 'wprowadź poniżej swój klucz API OpenAI',
    getKeyTip: 'Pobierz swój klucz API z pulpitu nawigacyjnego OpenAI',
    placeholder: 'Twój klucz API OpenAI (np. sk-xxxx)',
  },
  apiKeyInfo: {
    cloud: {
      trial: {
        title: 'Korzystasz z limitu próbnego {{providerName}}.',
        description:
          'Limit próbny jest dostarczany do użytku testowego. Zanim wykorzystasz dozwolone wywołania limitu próbnego, skonfiguruj swojego własnego dostawcę modelu lub zakup dodatkowy limit.',
      },
      exhausted: {
        title:
          'Twój limit próbny został wyczerpany, proszę skonfiguruj swój klucz API.',
        description:
          'Twój limit próbny został wyczerpany. Skonfiguruj swojego własnego dostawcę modelu lub zakup dodatkowy limit.',
      },
    },
    selfHost: {
      title: {
        row1: 'Aby rozpocząć,',
        row2: 'najpierw skonfiguruj swojego dostawcę modelu.',
      },
    },
    callTimes: 'Liczba wywołań',
    usedToken: 'Zużyty token',
    setAPIBtn: 'Przejdź do konfiguracji dostawcy modelu',
    tryCloud: 'Lub wypróbuj wersję chmurową Dify z darmowym limitem',
  },
  overview: {
    title: 'Przegląd',
    appInfo: {
      explanation: 'Gotowa do użycia aplikacja internetowa AI',
      accessibleAddress: 'Publiczny adres URL',
      preview: 'Podgląd',
      regenerate: 'Wygeneruj ponownie',
      regenerateNotice: 'Czy chcesz wygenerować ponownie publiczny adres URL?',
      preUseReminder: 'Przed kontynuowaniem włącz aplikację WebApp.',
      settings: {
        entry: 'Ustawienia',
        title: 'Ustawienia WebApp',
        webName: 'Nazwa WebApp',
        webDesc: 'Opis WebApp',
        webDescTip:
          'Ten tekst będzie wyświetlany po stronie klienta, zapewniając podstawowe wskazówki, jak korzystać z aplikacji',
        webDescPlaceholder: 'Wpisz opis WebApp',
        language: 'Język',
        more: {
          entry: 'Pokaż więcej ustawień',
          copyright: 'Prawa autorskie',
          copyRightPlaceholder: 'Wprowadź nazwę autora lub organizacji',
          privacyPolicy: 'Polityka prywatności',
          privacyPolicyPlaceholder: 'Wprowadź link do polityki prywatności',
          privacyPolicyTip:
            'Pomaga odwiedzającym zrozumieć, jakie dane zbiera aplikacja, zobacz <privacyPolicyLink>Politykę prywatności Dify</privacyPolicyLink>.',
          customDisclaimer: 'Oświadczenie o ochronie danych',
          customDisclaimerPlaceholder: 'Wprowadź oświadczenie o ochronie danych',
          customDisclaimerTip: 'Niestandardowy tekst oświadczenia będzie wyświetlany po stronie klienta, dostarczając dodatkowych informacji o aplikacji.',
        },
      },
      embedded: {
        entry: 'Osadzone',
        title: 'Osadź na stronie internetowej',
        explanation:
          'Wybierz sposób osadzenia aplikacji czatu na swojej stronie internetowej',
        iframe:
          'Aby dodać aplikację czatu w dowolnym miejscu na swojej stronie internetowej, dodaj ten kod iframe do swojego kodu HTML.',
        scripts:
          'Aby dodać aplikację czatu w prawym dolnym rogu swojej strony internetowej, dodaj ten kod do swojego HTML.',
        chromePlugin: 'Zainstaluj rozszerzenie Chrome Dify Chatbot',
        copied: 'Skopiowane',
        copy: 'Kopiuj',
      },
      qrcode: {
        title: 'Kod QR do udostępniania',
        scan: 'Skanuj aplikację udostępniania',
        download: 'Pobierz kod QR',
      },
      customize: {
        way: 'sposób',
        entry: 'Dostosuj',
        title: 'Dostosuj aplikację internetową AI',
        explanation:
          'Możesz dostosować front aplikacji internetowej do swoich scenariuszy i potrzeb stylowych.',
        way1: {
          name: 'Skopiuj kod klienta, zmodyfikuj go i wdroż na Vercel (zalecane)',
          step1: 'Skopiuj kod klienta i zmodyfikuj go',
          step1Tip:
            'Kliknij tutaj, aby skopiować kod źródłowy na swoje konto GitHub i zmodyfikować kod',
          step1Operation: 'Dify-WebClient',
          step2: 'Wdroż na Vercel',
          step2Tip:
            'Kliknij tutaj, aby zaimportować repozytorium do Vercel i wdrożyć',
          step2Operation: 'Import repozytorium',
          step3: 'Konfiguracja zmiennych środowiskowych',
          step3Tip: 'Dodaj następujące zmienne środowiskowe w Vercel',
        },
        way2: {
          name: 'Napisz kod po stronie klienta, aby wywołać API i wdrożyć go na serwerze',
          operation: 'Dokumentacja',
        },
      },
    },
    apiInfo: {
      title: 'API usługi w tle',
      explanation: 'Łatwe do zintegrowania z twoją aplikacją',
      accessibleAddress: 'Punkt końcowy API usługi',
      doc: 'Dokumentacja API',
    },
    status: {
      running: 'W usłudze',
      disable: 'Wyłącz',
    },
  },
  analysis: {
    title: 'Analiza',
    ms: 'ms',
    tokenPS: 'Tokeny/s',
    totalMessages: {
      title: 'Łączna liczba wiadomości',
      explanation:
        'Dzienna liczba interakcji z AI; inżynieria i debugowanie monitów wykluczone.',
    },
    activeUsers: {
      title: 'Aktywni użytkownicy',
      explanation:
        'Unikalni użytkownicy uczestniczący w pytaniach i odpowiedziach z AI; inżynieria i debugowanie monitów wykluczone.',
    },
    tokenUsage: {
      title: 'Zużycie tokenów',
      explanation:
        'Odbija dziennie używane tokeny modelu językowego dla aplikacji, przydatne do kontroli kosztów.',
      consumed: 'Zużyte',
    },
    avgSessionInteractions: {
      title: 'Śr. interakcji w sesji',
      explanation:
        'Liczba ciągłych komunikacji użytkownik-AI; dla aplikacji opartych na rozmowach.',
    },
    avgUserInteractions: {
      title: 'Śr. interakcji użytkownika',
      explanation:
        'Odbija dzienną częstotliwość użytkowania przez użytkowników. Ta metryka odzwierciedla przywiązanie użytkowników.',
    },
    userSatisfactionRate: {
      title: 'Wskaźnik zadowolenia użytkowników',
      explanation:
        'Liczba polubień na 1000 wiadomości. Wskazuje to proporcję odpowiedzi, z których użytkownicy są bardzo zadowoleni.',
    },
    avgResponseTime: {
      title: 'Śr. czas odpowiedzi',
      explanation:
        'Czas (ms) potrzebny AI na przetworzenie/odpowiedź; dla aplikacji opartych na tekście.',
    },
    tps: {
      title: 'Szybkość wydajności tokenów',
      explanation:
        'Mierzy wydajność LLM. Liczy szybkość wydajności tokenów LLM od początku żądania do zakończenia wyjścia.',
    },
  },
}

export default translation
