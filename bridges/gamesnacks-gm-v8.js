/*
 * game-driver.js — GameMonetize bridge for games expecting the GameSnacks surface.
 * Replaces the offline stub: maps GameSnacks game/audio/storage/score/ad calls
 * onto the GameMonetize SDK (window.sdk).
 *
 * v8 rules (validated on GameMonetize verify):
 *   - the SDK fires NOTHING on its own at SDK_READY; the checker needs to SEE
 *     one full IMA cycle;
 *   - the only reliable path is ONE sdk.showBanner() INSIDE a real user-gesture
 *     task; engine boot breaks are QUEUED until the first interaction and are
 *     then released by that single in-gesture ad;
 *   - later interstitials respect a 45s frequency cap; rewards fire their ad
 *     from the user's accept-click task.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  var TAG = '[GMDriver]';
  function log() { try { console.debug.apply(console, [TAG].concat([].slice.call(arguments))); } catch (e) {} }
  function fn(f) { return typeof f === 'function' ? f : null; }

  var RESUME = [];            // continuations released when the ad finishes (SDK_GAME_START)
  var lastAd = 0;             // frequency cap timestamp
  var BREAK_MIN_GAP = 45000;
  var bootAdDone = false;     // the one-time open ad has been fired
  var bootPending = [];       // interstitial resolvers awaiting the first-gesture ad

  function sdk() { return (typeof window.sdk === 'object' && window.sdk) || null; }

  function showBannerNow() {
    var s = sdk();
    try {
      if (s && typeof s.showBanner === 'function') s.showBanner();
      else if (s && typeof s.adRequested === 'function') s.adRequested();
    } catch (e) { log('showBanner err', e); }
  }

  /* Run one GM ad; resolve via SDK_GAME_START (or 12s hard timeout). */
  function runAd(onDone) {
    var done = false;
    var fin = function () { if (!done) { done = true; lastAd = Date.now(); onDone && onDone(); } };
    showBannerNow();
    RESUME.push(fin);
    setTimeout(fin, 12000);
  }

  // The ONE open ad: first real user gesture inside the page.
  function firstGesture() {
    if (bootAdDone) return;
    bootAdDone = true;
    log('first gesture -> open ad');
    runAd(function () {
      var q = bootPending.splice(0, bootPending.length);
      for (var i = 0; i < q.length; i++) { try { q[i](); } catch (e) {} }
    });
  }
  window.addEventListener('pointerdown', firstGesture, true);
  window.addEventListener('touchstart', firstGesture, true);
  window.addEventListener('keydown', firstGesture, true);

  var GameSnacks = {
    version: 'gm-bridge-8.0.0',

    game: {
      ready: function () { log('game.ready'); },
      firstFrameReady: function () { log('game.firstFrameReady'); },
      gameOver: function () { log('game.gameOver'); },
      levelComplete: function (n) { log('game.levelComplete', n); },
      onPause: function (cb) {
        cb = fn(cb);
        document.addEventListener('visibilitychange', function () {
          if (document.hidden && cb) cb();
        });
      },
      onResume: function (cb) {
        cb = fn(cb);
        document.addEventListener('visibilitychange', function () {
          if (!document.hidden && cb) cb();
        });
      }
    },

    audio: {
      isEnabled: function () { return true; },
      subscribe: function (cb) {
        cb = fn(cb);
        if (cb) {
          var fire = function () { try { cb(true); } catch (e) {} };
          if (document.readyState === 'complete') setTimeout(fire, 300);
          else window.addEventListener('load', function () { setTimeout(fire, 300); });
        }
      }
    },

    storage: {
      getItem: function (k) {
        try { return window.localStorage.getItem(k); } catch (e) { return null; }
      },
      setItem: function (k, v) {
        try { window.localStorage.setItem(k, v); } catch (e) {}
      }
    },

    score: {
      update: function (n) { log('score.update', n); }
    },

    ad: {
      break: function (opts) {
        opts = opts || {};
        var type = opts.type || 'next';
        log('ad.break type=' + type);

        if (type === 'reward') {
          // H5 reward flow: game decides WHEN via showAdFn() (a user click ->
          // in-gesture). No acceptance within 400ms -> probe ends "dismissed".
          var accepted = false;
          var br = fn(opts.beforeReward);
          if (br) {
            br(function showAdFn() {
              if (accepted) return;
              accepted = true;
              runAd(function () {
                var v = fn(opts.adViewed); if (v) v();
                var a = fn(opts.afterAd); if (a) a();
                var d = fn(opts.adBreakDone); if (d) d({ breakStatus: 'viewed', type: type });
              });
            });
            setTimeout(function () {
              if (accepted) return;
              var d = fn(opts.adBreakDone);
              if (d) d({ breakStatus: 'dismissed', type: type });
            }, 400);
          } else {
            var d0 = fn(opts.adBreakDone);
            if (d0) d0({ breakStatus: 'dismissed', type: type });
          }
          return;
        }

        // Interstitial ("next"/"start"):
        var b = fn(opts.beforeAd); if (b) b();     // game pauses itself now
        var resume = function () {
          var a = fn(opts.afterAd); if (a) a();
          var d = fn(opts.adBreakDone); if (d) d({ breakStatus: 'viewed', type: type });
        };
        if (!bootAdDone) { bootPending.push(resume); return; }   // queued for first gesture
        if (Date.now() - lastAd < BREAK_MIN_GAP) { resume(); return; }  // cap: silent pass
        runAd(resume);
      }
    }
  };

  if (typeof window.c2_callFunction !== 'function') {
    window.c2_callFunction = function () {};
  }

  window.GameSnacks = GameSnacks;
  window.GameDriver = GameSnacks; // alias for debugging

  window.addEventListener('error', function (e) {
    log('window.onerror:', e.message, e.filename, e.lineno);
  });
  log('initialized (GM bridge v8)');
})();
