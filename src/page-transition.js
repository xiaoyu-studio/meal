// 两个标签页之间的切换（跨文档视图过渡）。普通脚本，在两页的 <head> 里同步加载：
// pagereveal 在新页面第一帧之前就触发，模块脚本（defer）赶不上。
//
// 1. 新页面第一帧往往还没内容：翻牌子的卡片要等读完库才显示。过渡要是这时就开始，
//    淡进来的是一整片空底色，画面先暗一下、下一帧卡片才冒出来 —— 真机录屏里的「闪一下」。
//    所以过渡动画先停在第 0 帧（画面是旧页），等页面脚本调 markPageReady() 再播；
//    最多等 HOLD_MAX_MS，读库卡住也不会一直停着。从后台缓存恢复的页面内容本来就在，不停。
// 2. 底部色带：iOS 主屏 App 给整页拍快照时只拍到偏短的高度（真机 873 / 932），
//    下面那一截露的是新页面的底色，切换一开始就瞬间变色。css/style.css 的 .vt-band
//    盖在那一截上，只在切换期间显示，跟着整页一起交叉淡入。
// 3. 过渡被打断（还没播完又点了另一个标签）时浏览器那条 Promise 没人接，控制台会报
//    AbortError。被跳过时拒绝的是 ready，不是 finished —— 两条都要接。
(function () {
  var HOLD_MAX_MS = 400;
  var root = document.documentElement;
  var ready = false;
  var held = [];

  function release() {
    held.forEach(function (a) { try { a.play(); } catch (e) { /* 过渡已结束 */ } });
    held = [];
  }

  window.markPageReady = function () {
    ready = true;
    release();
  };

  window.addEventListener('pageswap', function (e) {
    var vt = e.viewTransition;
    if (!vt) return;
    vt.ready.catch(function () {});
    vt.finished.catch(function () {});
    // 旧页在拍快照之前把色带亮出来。这一页可能进后台缓存，回来时在 pageshow 里收掉。
    root.classList.add('vt-on');
  });

  window.addEventListener('pageshow', function (e) {
    if (e.persisted) root.classList.remove('vt-on');
  });

  window.addEventListener('pagereveal', function (e) {
    var vt = e.viewTransition;
    if (!vt) return;
    root.classList.add('vt-on');
    vt.finished.then(off, off);
    vt.ready.then(function () {
      if (ready) return;
      held = document.getAnimations().filter(function (a) {
        var pe = a.effect && a.effect.pseudoElement;
        return typeof pe === 'string' && pe.indexOf('::view-transition') === 0;
      });
      held.forEach(function (a) { a.pause(); });
      setTimeout(release, HOLD_MAX_MS);
    }, function () {});
  });

  function off() { root.classList.remove('vt-on'); }
})();
