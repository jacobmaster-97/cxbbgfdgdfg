(() => {
  const canvas = document.querySelector('main');
  const root = document.documentElement;
  root.classList.add('game-fit');
  let pending = null;
  function fit() {
    pending = null;
    const viewport = window.visualViewport;
    const width = viewport?.width || window.innerWidth;
    const height = viewport?.height || window.innerHeight;
    if (!width || !height || !canvas.offsetWidth) return;
    // Leave room for the dashboard's fixed return button when embedded.
    const footer = window.parent !== window && !document.fullscreenElement ? 72 : 12;
    const availableHeight = Math.max(1, height - footer - 12);
    const scale = Math.min((width - 24) / canvas.offsetWidth,
      availableHeight / Math.max(canvas.offsetHeight, canvas.scrollHeight));
    canvas.style.setProperty('--game-scale', String(Math.max(0.01, scale)));
    canvas.style.setProperty('--game-left', `${(viewport?.offsetLeft || 0) + width / 2}px`);
    canvas.style.setProperty('--game-top', `${(viewport?.offsetTop || 0) + 12 + availableHeight / 2}px`);
    window.scrollTo(0, 0);
  }
  function schedule() {
    if (pending === null) pending = requestAnimationFrame(fit);
  }
  window.GameViewport = { schedule };
  new ResizeObserver(schedule).observe(canvas);
  window.addEventListener('resize', schedule);
  window.addEventListener('pageshow', schedule);
  document.addEventListener('fullscreenchange', schedule);
  document.addEventListener('webkitfullscreenchange', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('scroll', schedule);
  document.fonts?.ready.then(schedule);
  schedule();
})();
