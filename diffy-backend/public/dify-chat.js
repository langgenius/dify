/**
 * Dependency-free streaming chat UI for Dify agents.
 *
 * Exposes a single global, window.mountDifyChat(container, options), used by
 * both chat.html (full page) and widget.js (bubble panel). The backend proxies
 * every call, so no Dify credentials are ever present here.
 *
 * options:
 *   backendUrl  - origin of this backend ("" for same-origin)
 *   storageKey  - prefix for localStorage, already scoped per page
 *   userId      - stable anonymous id, reused as Dify's `user`
 */
(function () {
  var STYLE_ID = "dify-chat-styles";

  var CSS = [
    ".dfy { display: flex; flex-direction: column; height: 100%; background: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a1a; }",
    ".dfy-log { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 14px; }",
    ".dfy-msg { max-width: 78%; padding: 10px 14px; border-radius: 14px; font-size: 14px; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; }",
    ".dfy-msg.user { align-self: flex-end; background: #000; color: #fff; border-bottom-right-radius: 4px; }",
    ".dfy-msg.assistant { align-self: flex-start; background: #f1f1f3; color: #1a1a1a; border-bottom-left-radius: 4px; }",
    ".dfy-msg.error { align-self: flex-start; background: #fdecea; color: #b3261e; }",
    ".dfy-dots span { display: inline-block; width: 6px; height: 6px; margin-right: 3px; border-radius: 50%; background: #999; animation: dfy-blink 1.2s infinite both; }",
    ".dfy-dots span:nth-child(2) { animation-delay: .2s; }",
    ".dfy-dots span:nth-child(3) { animation-delay: .4s; }",
    "@keyframes dfy-blink { 0%, 80%, 100% { opacity: .25 } 40% { opacity: 1 } }",
    ".dfy-suggestions { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 20px 12px; }",
    ".dfy-suggestions button { background: #fff; border: 1px solid #ddd; border-radius: 16px; padding: 6px 12px; font-size: 13px; cursor: pointer; color: #333; }",
    ".dfy-suggestions button:hover { border-color: #000; }",
    ".dfy-composer { display: flex; gap: 8px; align-items: flex-end; padding: 12px; border-top: 1px solid #eaeaea; background: #fff; }",
    ".dfy-composer textarea { flex: 1; resize: none; border: 1px solid #ddd; border-radius: 10px; padding: 10px 12px; font: inherit; font-size: 14px; line-height: 1.4; max-height: 140px; outline: none; }",
    ".dfy-composer textarea:focus { border-color: #000; }",
    ".dfy-composer button { flex: 0 0 auto; height: 38px; padding: 0 16px; border: none; border-radius: 10px; background: #000; color: #fff; font-size: 14px; cursor: pointer; }",
    ".dfy-composer button:disabled { opacity: .4; cursor: default; }",
    ".dfy-composer button.stop { background: #b3261e; }",
  ].join("\n");

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var el = document.createElement("style");
    el.id = STYLE_ID;
    el.textContent = CSS;
    document.head.appendChild(el);
  }

  function mountDifyChat(container, options) {
    injectStyles();

    var backend = options.backendUrl || "";
    var storageKey = options.storageKey;
    var userId = options.userId;
    var convKey = storageKey + "_dify_conversation";

    var conversationId = null;
    try {
      conversationId = localStorage.getItem(convKey) || null;
    } catch (e) {}

    // --- DOM ---

    container.innerHTML =
      '<div class="dfy">' +
      '  <div class="dfy-log" role="log" aria-live="polite"></div>' +
      '  <div class="dfy-suggestions" hidden></div>' +
      '  <form class="dfy-composer">' +
      '    <textarea rows="1" placeholder="Send a message…" aria-label="Message"></textarea>' +
      '    <button type="submit">Send</button>' +
      "  </form>" +
      "</div>";

    var log = container.querySelector(".dfy-log");
    var suggestions = container.querySelector(".dfy-suggestions");
    var form = container.querySelector(".dfy-composer");
    var input = form.querySelector("textarea");
    var sendBtn = form.querySelector("button");

    var activeTaskId = null;
    var abortController = null;

    // --- rendering (textContent only — never innerHTML with model output) ---

    function addMessage(role, text) {
      var el = document.createElement("div");
      el.className = "dfy-msg " + role;
      el.textContent = text || "";
      log.appendChild(el);
      scrollToBottom();
      return el;
    }

    function addTypingIndicator() {
      var el = document.createElement("div");
      el.className = "dfy-msg assistant";
      el.innerHTML = '<span class="dfy-dots"><span></span><span></span><span></span></span>';
      log.appendChild(el);
      scrollToBottom();
      return el;
    }

    function scrollToBottom() {
      log.scrollTop = log.scrollHeight;
    }

    function setBusy(busy) {
      input.disabled = busy;
      if (busy) {
        sendBtn.textContent = "Stop";
        sendBtn.classList.add("stop");
        sendBtn.type = "button";
      } else {
        sendBtn.textContent = "Send";
        sendBtn.classList.remove("stop");
        sendBtn.type = "submit";
        activeTaskId = null;
        abortController = null;
      }
    }

    function post(path, body) {
      return fetch(backend + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          Object.assign({ page_url: window.location.href, user_id: userId }, body)
        ),
      });
    }

    // --- streaming ---

    /**
     * Parse the SSE byte stream. Frames are separated by a blank line; we only
     * care about `data:` lines, which each carry one JSON event.
     */
    async function streamChat(query, bubble) {
      abortController = new AbortController();

      var res = await fetch(backend + "/dify/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortController.signal,
        body: JSON.stringify({
          page_url: window.location.href,
          user_id: userId,
          conversation_id: conversationId,
          query: query,
        }),
      });

      if (!res.ok || !res.body) {
        var detail = "";
        try {
          detail = (await res.json()).error || "";
        } catch (e) {}
        throw new Error(detail || "Request failed (" + res.status + ")");
      }

      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buffer = "";
      var answer = "";
      var started = false;

      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });

        // Keep the trailing partial frame in the buffer.
        var frames = buffer.split("\n\n");
        buffer = frames.pop();

        for (var i = 0; i < frames.length; i++) {
          var dataLines = frames[i]
            .split("\n")
            .filter(function (l) { return l.indexOf("data:") === 0; })
            .map(function (l) { return l.slice(5).trim(); });
          if (!dataLines.length) continue;

          var event;
          try {
            event = JSON.parse(dataLines.join("\n"));
          } catch (e) {
            continue; // ping frames and keepalive noise
          }

          if (event.conversation_id && event.conversation_id !== conversationId) {
            conversationId = event.conversation_id;
            try { localStorage.setItem(convKey, conversationId); } catch (e) {}
          }
          if (event.task_id) activeTaskId = event.task_id;

          switch (event.event) {
            case "message":
            case "agent_message":
              if (!started) {
                started = true;
                bubble.textContent = "";
              }
              answer += event.answer || "";
              bubble.textContent = answer;
              scrollToBottom();
              break;

            // A later correction replaces everything streamed so far
            // (moderation / sensitive-word replacement).
            case "message_replace":
              started = true;
              answer = event.answer || "";
              bubble.textContent = answer;
              scrollToBottom();
              break;

            case "error":
              throw new Error(event.message || "The agent returned an error");

            case "message_end":
              break;

            default:
              break; // ping, workflow_started, node_*, tts_*, message_file
          }
        }
      }

      if (!started) {
        bubble.textContent = "(no response)";
      }
    }

    // --- actions ---

    async function send(text) {
      var query = (text || "").trim();
      if (!query || input.disabled) return;

      suggestions.hidden = true;
      addMessage("user", query);
      input.value = "";
      input.style.height = "auto";
      setBusy(true);

      var bubble = addTypingIndicator();

      try {
        await streamChat(query, bubble);
      } catch (err) {
        if (err && err.name === "AbortError") {
          // User pressed Stop — keep whatever streamed in.
          if (!bubble.textContent) bubble.remove();
        } else {
          bubble.remove();
          addMessage("error", (err && err.message) || "Something went wrong.");
        }
      } finally {
        setBusy(false);
        input.focus();
      }
    }

    function stop() {
      if (abortController) abortController.abort();
      if (activeTaskId) {
        post("/dify/stop", { task_id: activeTaskId }).catch(function () {});
      }
    }

    // --- events ---

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      send(input.value);
    });

    sendBtn.addEventListener("click", function () {
      if (sendBtn.classList.contains("stop")) stop();
    });

    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send(input.value);
      }
    });

    input.addEventListener("input", function () {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 140) + "px";
    });

    // --- boot: resume conversation, else show the opening statement ---

    async function boot() {
      if (!conversationId) {
        try {
          var last = await post("/dify/last-conversation", {}).then(function (r) {
            return r.ok ? r.json() : null;
          });
          if (last && last.conversation_id) {
            conversationId = last.conversation_id;
            try { localStorage.setItem(convKey, conversationId); } catch (e) {}
          }
        } catch (e) {}
      }

      if (conversationId) {
        try {
          var hist = await post("/dify/history", {
            conversation_id: conversationId,
          }).then(function (r) { return r.ok ? r.json() : null; });
          if (hist && hist.messages && hist.messages.length) {
            hist.messages.forEach(function (m) {
              addMessage(m.role === "user" ? "user" : "assistant", m.content);
            });
            return;
          }
        } catch (e) {}
      }

      // Fresh conversation — greet with the app's configured opener.
      try {
        var params = await post("/dify/parameters", {}).then(function (r) {
          return r.ok ? r.json() : null;
        });
        if (params && params.opening_statement) {
          addMessage("assistant", params.opening_statement);
        }
        if (params && params.suggested_questions && params.suggested_questions.length) {
          params.suggested_questions.forEach(function (q) {
            var btn = document.createElement("button");
            btn.type = "button";
            btn.textContent = q;
            btn.addEventListener("click", function () { send(q); });
            suggestions.appendChild(btn);
          });
          suggestions.hidden = false;
        }
      } catch (e) {}
    }

    boot();

    return { send: send, stop: stop };
  }

  window.mountDifyChat = mountDifyChat;
})();
