!function(){const n="difyChatbotConfig",p=window[n];

async function e(){
  if(p && p.token){
    var e = new URLSearchParams(await async function(){
      var e=p?.inputs||{};const n={};return await Promise.all(Object.entries(e).map(async([e,t])=>{n[e]=(e=t,e=(new TextEncoder).encode(e),e=new Response(new Blob([e]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer(),e=new Uint8Array(await e),await btoa(String.fromCharCode(...e)))})),n}());

    const i = `${p.baseUrl || `https://${p.isDev ? "dev." : ""}udify.app`}/chatbot/${p.token}?` + e;

    function createFullscreenChatbot() {
      const iframe = document.createElement("iframe");
      iframe.allow = "fullscreen;microphone";
      iframe.title = "dify chatbot full screen";
      iframe.id = "dify-chatbot-fullscreen";
      iframe.src = i;
      iframe.style.cssText = `
        border: none;
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        z-index: 2147483647;
        background-color: #F3F4F6;
        overflow: hidden;
      `;
      document.body.appendChild(iframe);

      // Ensure no scrollbars appear on the body or html elements
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
    }

    // Create and append the fullscreen chatbot immediately
    createFullscreenChatbot();

    // Add a message listener to handle any resize events from the iframe content
    window.addEventListener('message', function(event) {
      if (event.data === 'resize') {
        const iframe = document.getElementById('dify-chatbot-fullscreen');
        if (iframe) {
          iframe.style.height = '100vh';
        }
      }
    });

  } else {
    console.error(n + " is empty or token is not provided");
  }
}

p?.dynamicScript ? e() : document.body.onload = e;
}();