/*!
 * BizAssist embeddable chat widget.
 *
 * One <script> tag drops the AI front desk onto ANY website — WordPress, Wix, Shopify,
 * Squarespace, plain HTML, anything. The client copies their snippet from the "Connect"
 * tab of their dashboard; it points here with their own `data-slug`.
 *
 *   <script src="https://www.bizzassist.xyz/widget.js"
 *           data-slug="bright-smile"
 *           data-name="Bright Smile Dental"
 *           data-color="#2E6B4F"
 *           data-greeting="Hi! 👋 How can I help you today?"
 *           data-position="right"
 *           defer></script>
 *
 * Everything lives inside a Shadow DOM so the host page's CSS can't break the widget and
 * the widget's CSS can't leak onto the host page. The only global exposed is
 * `window.BizAssist` ({ open, close, toggle }) so a site can trigger the chat from its own
 * button. No dependencies — one plain `fetch` to /api/chat, scoped to the client's slug.
 *
 * The AI only answers once the business's subscription is active (the API resolves the
 * tenant with active = true). Before that, the widget still installs and opens, and the
 * assistant replies with a friendly "not switched on yet" note.
 */
(function () {
  "use strict";

  // Guard against a double include (e.g. the snippet pasted twice).
  if (window.__bizassistWidgetLoaded) return;
  window.__bizassistWidgetLoaded = true;

  // currentScript is only reliable while the script is executing synchronously — grab it now.
  var script = document.currentScript;
  if (!script) {
    var all = document.getElementsByTagName("script");
    for (var i = all.length - 1; i >= 0; i--) {
      if (all[i].src && all[i].src.indexOf("widget.js") !== -1) { script = all[i]; break; }
    }
  }
  var data = (script && script.dataset) || {};

  // ── config (data-* attributes, all optional except slug) ─────────────────────────────
  var SLUG = (data.slug || "").trim();
  if (!SLUG) {
    console.warn("[BizAssist] widget.js loaded without data-slug — nothing to do. Add data-slug=\"your-slug\".");
    return;
  }
  // API origin: the origin this very script was served from (so it works on any host page).
  var API_BASE = (data.api || "").replace(/\/$/, "") ||
    (script && script.src ? new URL(script.src).origin : "https://www.bizzassist.xyz");

  var NAME = (data.name || "Front desk").slice(0, 60);
  var ACCENT = normalizeColor(data.color) || "#2E6B4F";
  var ON_ACCENT = readableOn(ACCENT); // black or white text that stays legible on ACCENT
  var GREETING = (data.greeting ||
    "Hi! 👋 Ask me about our services, hours, or book an appointment.").slice(0, 300);
  var SIDE = data.position === "left" ? "left" : "right";
  var LAUNCHER_LABEL = (data.launcher || "").slice(0, 40); // optional text next to the bubble
  var SHOW_BRANDING = data.branding !== "off";
  var GREETER = data.greeter !== "off"; // the little teaser bubble that pops after a moment

  var STORE_KEY = "bizassist:" + SLUG; // per-tenant conversation state, per browser session

  // ── helpers ──────────────────────────────────────────────────────────────────────────
  function normalizeColor(c) {
    if (!c) return null;
    c = String(c).trim();
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c)) return c;
    // Accept a bare hex without the leading # too.
    if (/^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c)) return "#" + c;
    return null;
  }
  // Pick black/white text for a given background so a client's brand color stays readable.
  function readableOn(hex) {
    var h = hex.replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    // Perceived luminance (sRGB) — > 0.6 is a light color, use dark ink.
    var lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.62 ? "#211C13" : "#FFFFFF";
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }
  function loadState() {
    try { return JSON.parse(sessionStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveState(s) {
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) {}
  }
  // A durable, anonymous visitor id (used for abuse limits / future analytics on the API).
  function visitorId() {
    try {
      var v = localStorage.getItem("bizassist_vid");
      if (!v) {
        v = "v_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
        localStorage.setItem("bizassist_vid", v);
      }
      return v;
    } catch (e) { return ""; }
  }

  var state = loadState();
  var history = Array.isArray(state.history) ? state.history : []; // { role, content }
  var VISITOR = visitorId();
  var isOpen = false, sending = false, greeted = false;

  // ── mount: a host element + Shadow DOM so nothing collides with the host page ─────────
  var host = document.createElement("div");
  host.id = "bizassist-widget";
  host.setAttribute("aria-live", "polite");
  // Only positioning lives on the host (in the light DOM) — everything else is shadowed.
  host.style.cssText =
    "position:fixed;z-index:2147483000;bottom:0;" + SIDE + ":0;width:0;height:0;";
  (document.body || document.documentElement).appendChild(host);
  var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;

  var INITIAL = esc(NAME).charAt(0).toUpperCase() || "•";
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var style = document.createElement("style");
  style.textContent = css();
  root.appendChild(style);

  var ui = document.createElement("div");
  ui.className = "wrap " + SIDE + (reduced ? " reduced" : "");
  ui.innerHTML = markup();
  root.appendChild(ui);

  // ── element refs ──────────────────────────────────────────────────────────────────────
  var $ = function (sel) { return root.querySelector(sel); };
  var launcher = $(".launcher");
  var panel = $(".panel");
  var thread = $(".thread");
  var input = $(".composer textarea");
  var sendBtn = $(".composer .send");
  var errEl = $(".err");
  var teaser = $(".teaser");

  // ── behavior ───────────────────────────────────────────────────────────────────────────
  function scrollDown() { thread.scrollTop = thread.scrollHeight; }

  function addMsg(role, text) {
    var el = document.createElement("div");
    el.className = "msg " + (role === "user" ? "user" : "bot");
    el.textContent = text;
    thread.appendChild(el);
    scrollDown();
    return el;
  }

  function renderHistory() {
    thread.querySelectorAll(".msg").forEach(function (n) { n.remove(); });
    if (!history.length) {
      addMsg("bot", GREETING);
    } else {
      history.forEach(function (m) { addMsg(m.role, m.content); });
    }
  }

  function open() {
    if (isOpen) return;
    isOpen = true;
    hideTeaser();
    ui.classList.add("open");
    panel.setAttribute("aria-hidden", "false");
    launcher.setAttribute("aria-expanded", "true");
    if (!thread.querySelector(".msg")) renderHistory();
    scrollDown();
    setTimeout(function () { try { input.focus(); } catch (e) {} }, reduced ? 0 : 220);
    persist();
  }
  function close() {
    if (!isOpen) return;
    isOpen = false;
    ui.classList.remove("open");
    panel.setAttribute("aria-hidden", "true");
    launcher.setAttribute("aria-expanded", "false");
    try { launcher.focus(); } catch (e) {}
    persist();
  }
  function toggle() { isOpen ? close() : open(); }

  function persist() {
    saveState({ history: history.slice(-24), opened: isOpen });
  }

  function showTeaser() {
    if (greeted || isOpen || !GREETER) return;
    teaser.querySelector(".teaser-text").textContent = GREETING;
    teaser.classList.add("show");
    greeted = true;
  }
  function hideTeaser() { teaser.classList.remove("show"); }

  async function send() {
    var text = input.value.trim();
    if (!text || sending) return;
    errEl.textContent = "";
    input.value = ""; autosize();
    addMsg("user", text);
    history.push({ role: "user", content: text });
    persist();

    sending = true; sendBtn.disabled = true;
    var typing = document.createElement("div");
    typing.className = "msg bot typing";
    typing.innerHTML = "<span></span><span></span><span></span>";
    thread.appendChild(typing); scrollDown();

    try {
      var res = await fetch(API_BASE + "/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: SLUG, messages: history.slice(-24), visitor: VISITOR }),
      });
      var payload = await res.json().catch(function () { return {}; });
      typing.remove();
      if (!res.ok) throw new Error(payload.error || "Something went wrong. Please try again.");
      var reply = payload.reply || "Sorry, I didn't catch that — could you say it another way?";
      addMsg("bot", reply);
      history.push({ role: "assistant", content: reply });
      persist();
    } catch (e) {
      typing.remove();
      errEl.textContent = e.message || "Network error — please try again.";
    } finally {
      sending = false; sendBtn.disabled = false;
      try { input.focus(); } catch (err) {}
    }
  }

  function autosize() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 110) + "px";
  }

  // ── wiring ───────────────────────────────────────────────────────────────────────────
  launcher.addEventListener("click", toggle);
  $(".panel .close").addEventListener("click", close);
  sendBtn.addEventListener("click", send);
  teaser.addEventListener("click", function (e) {
    if (e.target.closest(".teaser-x")) { hideTeaser(); return; }
    open();
  });
  input.addEventListener("input", autosize);
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });
  root.addEventListener("keydown", function (e) { if (e.key === "Escape" && isOpen) close(); });

  // A gentle teaser after a beat — only if they haven't opened it this session.
  if (!state.opened && GREETER) setTimeout(showTeaser, 1400);
  // If they had it open when they navigated to another page on the site, reopen it.
  if (state.opened) open();

  // Public control surface so a host site can wire its own "Chat with us" button.
  window.BizAssist = { open: open, close: close, toggle: toggle };

  // ── templates ───────────────────────────────────────────────────────────────────────
  function markup() {
    return [
      '<div class="teaser" role="button" tabindex="0" aria-label="Open chat">',
      '  <button class="teaser-x" aria-label="Dismiss">&times;</button>',
      '  <div class="teaser-text"></div>',
      '</div>',
      '<button class="launcher" aria-label="Chat with ' + esc(NAME) + '" aria-expanded="false">',
      '  <svg class="ic-chat" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-8.9 8.4 9 9 0 0 1-4.1-.9L3 20l1.1-4.9A8.38 8.38 0 0 1 3.5 11 8.5 8.5 0 0 1 12 3a8.5 8.5 0 0 1 9 8.5z"/></svg>',
      '  <svg class="ic-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
      '</button>',
      '<section class="panel" role="dialog" aria-label="' + esc(NAME) + ' chat" aria-hidden="true">',
      '  <header class="phead">',
      '    <div class="avatar">' + INITIAL + '</div>',
      '    <div class="pmeta"><div class="pname">' + esc(NAME) + '</div>',
      '      <div class="pstatus"><span class="dot"></span> Online — replies in seconds</div></div>',
      '    <button class="close" aria-label="Close chat"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>',
      '  </header>',
      '  <div class="thread" role="log" aria-live="polite"></div>',
      '  <div class="err" role="alert"></div>',
      '  <footer class="composer">',
      '    <textarea rows="1" placeholder="Type a message…" aria-label="Message"></textarea>',
      '    <button class="send" aria-label="Send message"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg></button>',
      '  </footer>',
      SHOW_BRANDING
        ? '  <a class="brandline" href="https://www.bizzassist.xyz" target="_blank" rel="noopener">Powered by <strong>BizAssist</strong></a>'
        : '',
      '</section>',
    ].join("");
  }

  function css() {
    return "" +
    ":host{all:initial;}" +
    "*{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;}" +
    ".wrap{--accent:" + ACCENT + ";--on-accent:" + ON_ACCENT + ";--ink:#211C13;--muted:#6b6555;--line:#ececec;--bg:#ffffff;--user:var(--accent);}" +
    ".wrap{position:fixed;bottom:20px;z-index:1;}" +
    ".wrap.right{right:20px;align-items:flex-end;}" +
    ".wrap.left{left:20px;align-items:flex-start;}" +

    /* launcher */
    ".launcher{position:fixed;bottom:20px;width:60px;height:60px;border-radius:50%;border:0;cursor:pointer;" +
      "background:var(--accent);color:var(--on-accent);display:flex;align-items:center;justify-content:center;" +
      "box-shadow:0 8px 26px -6px rgba(20,20,20,.4),0 2px 6px rgba(20,20,20,.16);transition:transform .18s ease,box-shadow .18s ease;}" +
    ".wrap.right .launcher{right:20px;}.wrap.left .launcher{left:20px;}" +
    ".launcher:hover{transform:translateY(-2px) scale(1.04);}" +
    ".launcher:active{transform:scale(.96);}" +
    ".launcher svg{width:27px;height:27px;position:absolute;transition:opacity .2s ease,transform .2s ease;}" +
    ".ic-close{opacity:0;transform:rotate(-90deg) scale(.6);}" +
    ".wrap.open .ic-chat{opacity:0;transform:rotate(90deg) scale(.6);}" +
    ".wrap.open .ic-close{opacity:1;transform:none;}" +

    /* teaser bubble */
    ".teaser{position:fixed;bottom:92px;max-width:260px;background:var(--bg);color:var(--ink);" +
      "border:1px solid var(--line);border-radius:16px;padding:13px 34px 13px 15px;font-size:14px;line-height:1.45;" +
      "box-shadow:0 12px 34px -12px rgba(20,20,20,.3);cursor:pointer;opacity:0;transform:translateY(8px);" +
      "pointer-events:none;transition:opacity .25s ease,transform .25s ease;}" +
    ".wrap.right .teaser{right:22px;}.wrap.left .teaser{left:22px;}" +
    ".teaser.show{opacity:1;transform:none;pointer-events:auto;}" +
    ".teaser-x{position:absolute;top:6px;right:8px;border:0;background:transparent;color:var(--muted);" +
      "font-size:19px;line-height:1;cursor:pointer;padding:2px 4px;border-radius:6px;}" +
    ".teaser-x:hover{background:#f2f2f2;}" +

    /* panel */
    ".panel{position:fixed;bottom:92px;width:384px;max-width:calc(100vw - 32px);height:600px;max-height:calc(100vh - 116px);" +
      "background:var(--bg);border:1px solid var(--line);border-radius:20px;overflow:hidden;display:flex;flex-direction:column;" +
      "box-shadow:0 24px 60px -18px rgba(20,20,20,.42),0 6px 16px -8px rgba(20,20,20,.25);" +
      "opacity:0;transform:translateY(14px) scale(.98);pointer-events:none;transform-origin:bottom right;" +
      "transition:opacity .24s cubic-bezier(.22,.9,.3,1),transform .24s cubic-bezier(.22,.9,.3,1);}" +
    ".wrap.right .panel{right:20px;}.wrap.left .panel{left:20px;transform-origin:bottom left;}" +
    ".wrap.open .panel{opacity:1;transform:none;pointer-events:auto;}" +
    ".wrap.reduced .panel,.wrap.reduced .launcher svg,.wrap.reduced .teaser{transition:none;}" +

    /* header */
    ".phead{display:flex;align-items:center;gap:11px;padding:15px 16px;background:var(--accent);color:var(--on-accent);flex:none;}" +
    ".avatar{width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,.22);color:var(--on-accent);" +
      "display:flex;align-items:center;justify-content:center;font-weight:700;font-size:17px;flex:none;}" +
    ".pmeta{flex:1;min-width:0;}" +
    ".pname{font-weight:700;font-size:15.5px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}" +
    ".pstatus{font-size:12px;opacity:.9;display:flex;align-items:center;gap:6px;margin-top:2px;}" +
    ".pstatus .dot{width:7px;height:7px;border-radius:50%;background:#8ff0b0;box-shadow:0 0 0 0 rgba(143,240,176,.6);}" +
    ".close{border:0;background:transparent;color:var(--on-accent);opacity:.85;cursor:pointer;padding:6px;border-radius:8px;line-height:0;}" +
    ".close:hover{opacity:1;background:rgba(255,255,255,.16);}.close svg{width:20px;height:20px;}" +

    /* thread */
    ".thread{flex:1;overflow-y:auto;padding:18px 16px;display:flex;flex-direction:column;gap:10px;background:#faf9f6;}" +
    ".msg{max-width:82%;padding:10px 14px;border-radius:16px;font-size:14.5px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word;animation:ba-in .2s ease both;}" +
    ".wrap.reduced .msg{animation:none;}" +
    ".msg.bot{background:#fff;border:1px solid var(--line);color:var(--ink);align-self:flex-start;border-bottom-left-radius:5px;}" +
    ".msg.user{background:var(--user);color:var(--on-accent);align-self:flex-end;border-bottom-right-radius:5px;}" +
    ".msg.typing{display:flex;gap:4px;align-items:center;}" +
    ".msg.typing span{width:7px;height:7px;border-radius:50%;background:#c3bdae;animation:ba-bounce 1.2s infinite ease-in-out;}" +
    ".msg.typing span:nth-child(2){animation-delay:.15s;}.msg.typing span:nth-child(3){animation-delay:.3s;}" +
    "@keyframes ba-in{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:none;}}" +
    "@keyframes ba-bounce{0%,80%,100%{transform:scale(.6);opacity:.5;}40%{transform:scale(1);opacity:1;}}" +

    /* error */
    ".err{color:#B4402E;font-size:12.5px;padding:0 16px;min-height:0;}" +
    ".err:not(:empty){padding:8px 16px 0;}" +

    /* composer */
    ".composer{display:flex;gap:9px;align-items:flex-end;padding:12px 14px;border-top:1px solid var(--line);background:#fff;flex:none;}" +
    ".composer textarea{flex:1;resize:none;border:1px solid var(--line);border-radius:13px;padding:10px 13px;font-size:14.5px;" +
      "line-height:1.4;max-height:110px;color:var(--ink);background:#fff;outline:none;transition:border-color .15s ease,box-shadow .15s ease;}" +
    ".composer textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 18%,transparent);}" +
    ".composer .send{flex:none;width:42px;height:42px;border-radius:12px;border:0;background:var(--accent);color:var(--on-accent);" +
      "cursor:pointer;display:flex;align-items:center;justify-content:center;transition:transform .15s ease,opacity .15s ease;}" +
    ".composer .send:hover{transform:translateY(-1px);}.composer .send:active{transform:none;}" +
    ".composer .send:disabled{opacity:.5;cursor:default;transform:none;}.composer .send svg{width:19px;height:19px;}" +

    /* branding */
    ".brandline{display:block;text-align:center;font-size:11px;color:var(--muted);text-decoration:none;padding:7px 0 9px;background:#fff;flex:none;}" +
    ".brandline strong{color:var(--ink);font-weight:700;}.brandline:hover{color:var(--ink);}" +

    /* mobile: near-fullscreen panel */
    "@media (max-width:480px){" +
      ".panel{width:100vw;max-width:100vw;height:100vh;max-height:100vh;bottom:0;right:0 !important;left:0 !important;border-radius:0;border:0;}" +
      ".wrap.open .launcher{opacity:0;pointer-events:none;}" +
      ".teaser{max-width:calc(100vw - 90px);}" +
    "}";
  }
})();
