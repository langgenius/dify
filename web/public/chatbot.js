!(function() {
  const CONFIG_KEY = 'difyChatbotConfig';
  const config = window[CONFIG_KEY];

  async function initChatbot() {
    if (!config || !config.token) {
      console.error(CONFIG_KEY + ' is empty or token is not provided');
      return;
    }

    // Create URL with compressed inputs
    const params = new URLSearchParams(
      await (async function() {
        const inputs = config?.inputs || {};
        const compressedInputs = {};
        
        await Promise.all(
          Object.entries(inputs).map(async ([key, value]) => {
            const encoded = new TextEncoder().encode(value);
            const compressed = await new Response(
              new Blob([encoded])
                .stream()
                .pipeThrough(new CompressionStream('gzip'))
            ).arrayBuffer();
            const uint8Array = new Uint8Array(await compressed);
            compressedInputs[key] = btoa(String.fromCharCode(...uint8Array));
          })
        );
        
        return compressedInputs;
      })()
    );

    const chatbotUrl = `${config.baseUrl || `https://${config.isDev ? 'dev.' : ''}udify.app`}/chatbot/${config.token}?${params}`;

    // Create and inject iframe into the container
    const container = document.getElementById('chatbot');
    if (!container) {
      console.error('Chatbot container element not found');
      return;
    }

    const iframe = document.createElement('iframe');
    iframe.src = chatbotUrl;
    iframe.allow = 'microphone';
    iframe.style.cssText = 'border: none; width: 100%; height: 100%;';
    
    container.appendChild(iframe);
  }

  // Initialize based on config
  config?.dynamicScript ? initChatbot() : document.body.onload = initChatbot;
})();