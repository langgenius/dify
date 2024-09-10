const translation = {
  apiServer: 'Serwer API',
  apiKey: 'Klucz API',
  status: 'Status',
  disabled: 'Wyłączony',
  ok: 'W usłudze',
  copy: 'Kopiuj',
  copied: 'Skopiowane',
  play: 'Graj',
  pause: 'Pauza',
  playing: 'Gra',
  loading: 'Ładowanie',
  merMaid: {
    rerender: 'Przerób Renderowanie',
  },
  never: 'Nigdy',
  apiKeyModal: {
    apiSecretKey: 'Tajny klucz API',
    apiSecretKeyTips:
      'Aby zapobiec nadużyciom API, chron swój klucz API. Unikaj używania go jako zwykłego tekstu w kodzie front-end. :)',
    createNewSecretKey: 'Utwórz nowy tajny klucz',
    secretKey: 'Tajny Klucz',
    created: 'UTWORZONY',
    lastUsed: 'OSTATNIO UŻYWANY',
    generateTips: 'Przechowuj ten klucz w bezpiecznym i dostępnym miejscu.',
  },
  actionMsg: {
    deleteConfirmTitle: 'Usunąć ten tajny klucz?',
    deleteConfirmTips: 'Tej akcji nie można cofnąć.',
    ok: 'OK',
  },
  completionMode: {
    title: 'Zakończenie App API',
    info: 'Do generowania tekstu wysokiej jakości, takiego jak artykuły, podsumowania i tłumaczenia, użyj API completion-messages z danymi wejściowymi użytkownika. Generowanie tekstu zależy od parametrów modelu i szablonów promptów ustawionych w Dify Prompt Engineering.',
    createCompletionApi: 'Utwórz Wiadomość Zakończenia',
    createCompletionApiTip:
      'Utwórz Wiadomość Zakończenia, aby obsługiwać tryb pytanie-odpowiedź.',
    inputsTips:
      '(Opcjonalnie) Podaj pola wejściowe użytkownika jako pary klucz-wartość, odpowiadające zmiennym w Prompt Eng. Klucz to nazwa zmiennej, Wartość to wartość parametru. Jeśli typ pola to Wybierz, przesłana Wartość musi być jednym z predefiniowanych wyborów.',
    queryTips: 'Treść tekstu wprowadzanego przez użytkownika.',
    blocking:
      'Typ blokujący, czekanie na zakończenie wykonania i zwrócenie wyników. (Żądania mogą być przerywane, jeśli proces jest długi)',
    streaming:
      'zwraca strumieniowo. Implementacja strumieniowego zwrotu na podstawie SSE (Server-Sent Events).',
    messageFeedbackApi: 'Informacje zwrotne o wiadomości (lubię)',
    messageFeedbackApiTip:
      'Oceniaj otrzymane wiadomości w imieniu użytkowników końcowych na podstawie polubień lub niepolubień. Te dane są widoczne na stronie Logi i adnotacje i są używane do przyszłego dostrojenia modelu.',
    messageIDTip: 'ID wiadomości',
    ratingTip: 'lubię lub nie lubię, null to cofnięcie',
    parametersApi: 'Uzyskaj informacje o parametrach aplikacji',
    parametersApiTip:
      'Pobierz skonfigurowane parametry wejściowe, w tym nazwy zmiennych, nazwy pól, typy i domyślne wartości. Zwykle używane do wyświetlania tych pól w formularzu lub wypełniania domyślnych wartości po załadowaniu klienta.',
  },
  chatMode: {
    title: 'Chat App API',
    info: 'Do wszechstronnych aplikacji konwersacyjnych w formacie Q&A, wywołaj API chat-messages, aby rozpocząć dialog. Utrzymuj trwające rozmowy, przekazując zwrócone conversation_id. Parametry odpowiedzi i szablony zależą od ustawień Dify Prompt Eng.',
    createChatApi: 'Utwórz wiadomość czatu',
    createChatApiTip:
      'Utwórz nową wiadomość konwersacji lub kontynuuj istniejący dialog.',
    inputsTips:
      '(Opcjonalnie) Podaj pola wejściowe użytkownika jako pary klucz-wartość, odpowiadające zmiennym w Prompt Eng. Klucz to nazwa zmiennej, Wartość to wartość parametru. Jeśli typ pola to Wybierz, przesłana Wartość musi być jednym z predefiniowanych wyborów.',
    queryTips: 'Treść pytania/wprowadzanej przez użytkownika',
    blocking:
      'Typ blokujący, czekanie na zakończenie wykonania i zwrócenie wyników. (Żądania mogą być przerywane, jeśli proces jest długi)',
    streaming:
      'zwraca strumieniowo. Implementacja strumieniowego zwrotu na podstawie SSE (Server-Sent Events).',
    conversationIdTip:
      '(Opcjonalnie) ID rozmowy: pozostaw puste dla pierwszej rozmowy; przekaż conversation_id z kontekstu, aby kontynuować dialog.',
    messageFeedbackApi: 'Informacje zwrotne od użytkownika terminala, lubię',
    messageFeedbackApiTip:
      'Oceniaj otrzymane wiadomości w imieniu użytkowników końcowych na podstawie polubień lub niepolubień. Te dane są widoczne na stronie Logi i adnotacje i są używane do przyszłego dostrojenia modelu.',
    messageIDTip: 'ID wiadomości',
    ratingTip: 'lubię lub nie lubię, null to cofnięcie',
    chatMsgHistoryApi: 'Pobierz historię wiadomości czatu',
    chatMsgHistoryApiTip:
      'Pierwsza strona zwraca najnowsze `limit` wiadomości, które są w odwrotnej kolejności.',
    chatMsgHistoryConversationIdTip: 'ID rozmowy',
    chatMsgHistoryFirstId:
      'ID pierwszego rekordu czatu na bieżącej stronie. Domyślnie brak.',
    chatMsgHistoryLimit: 'Ile czatów jest zwracanych w jednym żądaniu',
    conversationsListApi: 'Pobierz listę rozmów',
    conversationsListApiTip:
      'Pobiera listę sesji bieżącego użytkownika. Domyślnie zwraca ostatnie 20 sesji.',
    conversationsListFirstIdTip:
      'ID ostatniego rekordu na bieżącej stronie, domyślnie brak.',
    conversationsListLimitTip: 'Ile czatów jest zwracanych w jednym żądaniu',
    conversationRenamingApi: 'Zmiana nazwy rozmowy',
    conversationRenamingApiTip:
      'Zmień nazwy rozmów; nazwa jest wyświetlana w interfejsach klienta wielosesyjnego.',
    conversationRenamingNameTip: 'Nowa nazwa',
    parametersApi: 'Uzyskaj informacje o parametrach aplikacji',
    parametersApiTip:
      'Pobierz skonfigurowane parametry wejściowe, w tym nazwy zmiennych, nazwy pól, typy i domyślne wartości. Zwykle używane do wyświetlania tych pól w formularzu lub wypełniania domyślnych wartości po załadowaniu klienta.',
  },
  develop: {
    requestBody: 'Ciało żądania',
    pathParams: 'Parametry ścieżki',
    query: 'Zapytanie',
  },
}

export default translation
