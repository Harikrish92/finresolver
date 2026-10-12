/* ============================================================
   finova-voice.js — speak to FINOVA (both UIs)

   Uses the browser's built-in speech recognition (Chrome, Edge,
   Safari). English (India) only for now. What was heard is put into
   the search bar for the user to check — it is never sent on its own,
   and entries still need the usual confirm. Anything the recogniser
   can't make out ends with a plain message telling the user so.

   Markup: a button with data-finova-mic and the hidden attribute.
   setupAll() shows it only where speech recognition exists.
   ============================================================ */
(function () {
  /* PAUSED 2026-10-12: needs more real-device testing before users see it.
     Set to true to bring the mic back (tests force it on via
     window.FINOVA_VOICE_ENABLED). */
  var VOICE_ENABLED = window.FINOVA_VOICE_ENABLED === true || false;

  var SR = (VOICE_ENABLED && (window.SpeechRecognition || window.webkitSpeechRecognition)) || null;
  var LANG = 'en-IN';
  var MAX_LISTEN_MS = 15000;     // Safari sometimes never ends on its own
  var LOW_CONFIDENCE = 0.5;      // 0 means "not reported", not "unsure"
  var NOTE_KEY = 'fr_finova_voice_noted';

  var MESSAGES = {
    'no-speech':     "🎤 I didn't hear anything. Tap the mic and start speaking straight away.",
    'no-match':      "🎤 Sorry, I couldn't understand that. Please try again a bit more clearly, or type it instead.",
    'audio-capture': '🎤 No microphone found. Check that your device has one and no other app is using it.',
    'not-allowed':   '🎤 Microphone access is blocked. Allow it for this site in your browser settings, then try again.',
    'network':       '🎤 Voice input needs an internet connection. Please check yours and try again.',
    'language-not-supported': "🎤 English voice input isn't available in this browser. Please type instead.",
    'other':         '🎤 Voice input stopped unexpectedly. Please try again, or type instead.',
  };
  MESSAGES['service-not-allowed'] = MESSAGES['not-allowed'];

  var session = null;
  var last = null;   // { prefix, filled }: what the previous attempt put in the box

  function supported() { return !!SR; }

  function setupAll(root) {
    if (!supported()) return;
    (root || document).querySelectorAll('[data-finova-mic]').forEach(function (b) { b.hidden = false; });
  }

  function joinText(prefix, spoken) {
    if (!prefix) return spoken;
    return prefix + (/[\s₹]$/.test(prefix) ? '' : ' ') + spoken;
  }

  function finish(s) {
    if (s.done) return;
    s.done = true;
    clearTimeout(s.timer);
    if (session === s) session = null;
    s.button.classList.remove('fnv-mic-on');
    s.button.setAttribute('aria-pressed', 'false');
    s.input.placeholder = s.placeholder;
    if (s.cancelled) return;

    var heard = s.finalText.trim() || s.interimText.trim();
    if (!heard) {
      s.input.value = s.prefix;
      s.autosize(s.input);
      // An error event has already explained itself; otherwise nothing usable came back.
      if (s.error !== 'aborted') s.onMessage(MESSAGES[s.error] || MESSAGES['no-match']);
      return;
    }
    s.input.value = joinText(s.prefix, heard);
    last = { prefix: s.prefix, filled: s.input.value };
    s.autosize(s.input);
    s.input.focus();
    try { s.input.setSelectionRange(s.input.value.length, s.input.value.length); } catch (e) {}
    if (!s.finalText.trim() || (s.confidence > 0 && s.confidence < LOW_CONFIDENCE)) {
      s.onMessage("🎤 I'm not sure I heard that right. Please check the text and fix it before sending.");
    }
  }

  /* opts: { input, button, onMessage(msg), autosize(input) } */
  function toggle(opts) {
    if (session) { session.rec.stop(); return; }   // second tap = "I'm done"
    if (!supported()) { opts.onMessage("🎤 Voice input isn't supported in this browser. Try Chrome, Edge or Safari."); return; }

    // Trying again right after a misheard attempt replaces it rather than appending to it.
    var current = opts.input.value;
    var prefix = (last && current === last.filled) ? last.prefix : current.replace(/\s+$/, ' ');

    var rec = new SR();
    rec.lang = LANG;
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;

    var s = {
      rec: rec, input: opts.input, button: opts.button,
      onMessage: opts.onMessage, autosize: opts.autosize || function () {},
      prefix: prefix,   // e.g. a chip's "Add an expense of ₹"
      placeholder: opts.input.placeholder,
      finalText: '', interimText: '', confidence: 0,
      error: null, cancelled: false, done: false, timer: null,
    };

    rec.onresult = function (ev) {
      var fin = '', interim = '', conf = 0;
      for (var i = 0; i < ev.results.length; i++) {
        var r = ev.results[i], alt = r[0];
        if (!alt) continue;
        if (r.isFinal) { fin += alt.transcript; conf = alt.confidence || conf; }
        else interim += alt.transcript;
      }
      s.finalText = fin; s.interimText = interim; s.confidence = conf;
      if (s.cancelled) return;
      s.input.value = joinText(s.prefix, (fin + interim).trim());   // live preview
      s.autosize(s.input);
    };
    rec.onnomatch = function () { s.error = s.error || 'no-match'; };
    rec.onerror = function (ev) {
      var code = ev && ev.error;
      s.error = (MESSAGES[code] || code === 'aborted') ? code : 'other';
    };
    rec.onend = function () { finish(s); };

    try { rec.start(); } catch (e) { opts.onMessage(MESSAGES.other); return; }
    session = s;
    s.timer = setTimeout(function () { try { rec.stop(); } catch (e) {} }, MAX_LISTEN_MS);
    s.button.classList.add('fnv-mic-on');
    s.button.setAttribute('aria-pressed', 'true');
    s.input.placeholder = 'Listening… speak now';

    // First use: say where the audio goes (Chrome sends it to Google for transcription).
    try {
      if (!localStorage.getItem(NOTE_KEY)) {
        localStorage.setItem(NOTE_KEY, '1');
        opts.onMessage("🎤 Your browser's speech service turns your voice into text (in Chrome that's Google). " +
          'You can check the text before sending, and nothing is saved until you confirm.');
      }
    } catch (e) {}
  }

  /* Called when a message is sent: drop any recognition still running so a
     late result can't refill the box that was just cleared. */
  function cancel() {
    if (!session) return;
    var s = session;
    s.cancelled = true;
    try { s.rec.abort(); } catch (e) {}
    finish(s);
  }

  window.FinovaVoice = { supported: supported, setupAll: setupAll, toggle: toggle, cancel: cancel };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setupAll(); });
  else setupAll();
})();
