/*
 * game-driver.js — GameMonetize bridge for Construct 3 games expecting a PokiSDK surface.
 * Replaces the offline stub: maps the game's ad/lifecycle calls onto the GameMonetize SDK.
 *   PokiSDK.commercialBreak()  -> sdk.showBanner()   (game is paused by the engine around the break)
 *   PokiSDK.rewardedBreak()    -> sdk.showBanner()   (reward granted on resolve, gated by SDK_GAME_START)
 *   PokiSDK.gameLoadingProgress/Finished -> informational only
 * Load order: engine loads this first, then calls PokiSDK.init(). The sdk.js loader lives in index.html.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  if (window.PokiSDK && window.PokiSDK.__gmBridge) return;

  var RESUME = [];                    // continuations released by SDK_GAME_START (ad finished)
  var lastBreak = 0;                  // frequency cap: GameMonetize review wants >=45s between ads
  var BREAK_MIN_GAP = 45000;
  /* v8: the SDK fires NOTHING on its own at SDK_READY — the platform checker needs
   * to SEE a full IMA cycle. The only reliable path (proven by an earlier success)
   * is ONE showBanner() call INSIDE a real user-gesture task, right after SDK_READY.
   * So: engine boot breaks are QUEUED until the first interaction inside the frame;
   * that first interaction fires the single open ad (in-gesture) and releases the
   * queue. Later breaks flow normally through the frequency cap. */
  var queuedBoot = [];                // boot commercialBreak resolvers awaiting first interaction
  var bootAdDone = false;             // the one-time open ad has been fired

  function sdk() { return (typeof window.sdk === 'object' && window.sdk) || null; }

  function showAd(onDone) {
    var done = false;
    var fin = function () { if (!done) { done = true; onDone && onDone(); } };
    var s = sdk();
    try {
      if (s && typeof s.showBanner === 'function') s.showBanner();
      else if (s && typeof s.adRequested === 'function') s.adRequested();
    } catch (e) {}
    RESUME.push(fin);                 // normally released by SDK_GAME_START
    setTimeout(fin, 12000);           // hard timeout: never freeze gameplay
  }

  var bridge = {
    __gmBridge: true,

    init: function () { return Promise.resolve(); },
    setDebug: function () {},
    setLogCloudflare: function () {},
    debug: function () {},
    measure: function () {},
    customEvent: function () {},
    logEvent: function () {},
    sendClientEvent: function () {},
    shareableURL: function () { return Promise.resolve({ url: location.href }); },

    gameLoadingStart: function () {},
    gameLoadingProgress: function () {},
    gameLoadingFinished: function () {},

    gameplayStart: function () {},
    gameplayStop: function () {},

    /* Interstitial break. The C3 engine pauses itself around commercialBreak.
     * v8: boot-time breaks (before any interaction) are queued — the gesture
     * handler fires the single open ad and releases them. */
    commercialBreak: function () {
      return new Promise(function (resolve) {
        if (!bootAdDone && !interacted()) { queuedBoot.push(resolve); return; }
        var now = Date.now();
        if (now - lastBreak < BREAK_MIN_GAP) { resolve(); return; }
        lastBreak = now;
        showAd(resolve);
      });
    },

    /* Rewarded: resolve({success:true}) when the ad flow completed (SDK_GAME_START). */
    rewardedBreak: function () {
      return new Promise(function (resolve) {
        if (!bootAdDone && !interacted()) { resolve({ success: true }); return; }
        var now = Date.now();
        var gap = now - lastBreak;
        if (gap < BREAK_MIN_GAP) { setTimeout(function () { resolve({ success: true }); }, BREAK_MIN_GAP - gap); return; }
        lastBreak = now;
        var done = false;
        showAd(function () { if (!done) { done = true; resolve({ success: true }); } });
      });
    },

    happyTime: function () {},
  };

  window.PokiSDK = bridge;
  window.GameDriver = bridge;
  window.PokiHasInitialised = true;
  if (!window.PokiSDK_InitOK) window.PokiSDK_InitOK = true;

  // GameMonetize lifecycle hook (chain the page's own handler).
  window.SDK_OPTIONS = window.SDK_OPTIONS || {};
  var prevOnEvent = window.SDK_OPTIONS.onEvent;
  window.SDK_OPTIONS.onEvent = function (a) {
    try {
      switch (a && a.name) {
        case 'SDK_GAME_START':
          var pending = RESUME.splice(0, RESUME.length);
          for (var i = 0; i < pending.length; i++) { try { pending[i](); } catch (e) {} }
          break;
        case 'SDK_READY':
          /* The SDK fires nothing by itself here. Stamp the cap clock so the
           * first ad (fired on first interaction) is never throttled by an
           * engine break that ran during loading. */
          lastBreak = Date.now();
          break;
        case 'SDK_GAME_PAUSE':
          // engine pause happens around the break; nothing extra needed here
          break;
      }
    } catch (e) {}
    if (typeof prevOnEvent === 'function') { try { prevOnEvent(a); } catch (e) {} }
  };

  /* True once a real interaction happened inside this frame. */
  var _interacted = false;
  function interacted() { return _interacted; }

  /* First interaction inside the frame: fire THE open ad inside this gesture
   * task (IMA serves gestures only), then release queued boot breaks. */
  function markInteraction() {
    if (bootAdDone) return;
    bootAdDone = true;
    _interacted = true;
    var s = sdk();
    var w = queuedBoot.splice(0, queuedBoot.length);
    lastBreak = Date.now();
    if (s && typeof s.showBanner === 'function') { try { s.showBanner(); } catch (e) {} }
    if (w.length) {
      var done = false;
      var fin = function () {
        if (!done) { done = true; for (var i = 0; i < w.length; i++) { try { w[i](); } catch (e) {} } }
      };
      RESUME.push(fin);            // release on SDK_GAME_START (ad finished)
      setTimeout(fin, 12000);      // hard safety: never freeze gameplay
    }
  }
  try {
    document.addEventListener('pointerdown', markInteraction, true);
    document.addEventListener('keydown', markInteraction, true);
  } catch (e) {}
})();
