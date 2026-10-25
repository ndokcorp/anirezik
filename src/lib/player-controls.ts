export function formatPlayerTime(seconds: number) {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(value / 3600),
    minutes = Math.floor((value % 3600) / 60);
  const tail = `${String(minutes).padStart(hours ? 2 : 1, '0')}:${String(value % 60).padStart(2, '0')}`;
  return hours ? `${hours}:${tail}` : tail;
}
export function seekTarget(current: number, duration: number, delta: number) {
  return Number.isFinite(duration) && duration > 0
    ? Math.min(duration, Math.max(0, current + delta))
    : null;
}
const paths = {
  play: 'M8 4l12 8-12 8z',
  pause: 'M8 5v14M16 5v14',
  volume: 'M3 9h4l5-5v16l-5-5H3zM16 8a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14',
  muted: 'M3 9h4l5-5v16l-5-5H3zM16 9l6 6M16 15l6-6',
  settings:
    'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1zM16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  fullscreen: 'M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6',
  previous: 'M5 5v14M19 5l-10 7 10 7z',
  next: 'M19 5v14M5 5l10 7-10 7z',
  forward: 'M19 4v6h-6M19 10a8 8 0 1 0 1 6',
  backward: 'M5 4v6h6M5 10a8 8 0 1 1-1 6',
} as const;
export function playerIcon(name: keyof typeof paths) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({
    viewBox: '0 0 24 24',
    width: '22',
    height: '22',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': name === 'pause' ? '3' : '1.8',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  }))
    svg.setAttribute(key, value);
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', paths[name]);
  if (name === 'play' || name === 'previous' || name === 'next')
    path.setAttribute('fill', 'currentColor');
  svg.append(path);
  return svg;
}
/** Only our HTML5 surface. No iframe access, global shortcuts, or media-stream handling. */
export function bindPlayerGestures(
  screen: HTMLElement,
  media: HTMLVideoElement,
  options: {
    toggle: () => void;
    mute: () => void;
    signal: AbortSignal;
  },
) {
  const feedback = document.createElement('div');
  feedback.className = 'player-seek-feedback';
  feedback.setAttribute('role', 'status');
  feedback.setAttribute('aria-live', 'polite');
  screen.append(feedback);
  let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
  let tapTimer: ReturnType<typeof setTimeout> | undefined;
  let lastTap: { time: number; side: number } | undefined;
  let ignoreClickUntil = 0;
  const seek = (delta: number) => {
    const target = seekTarget(media.currentTime, media.duration, delta);
    if (target === null) return;
    media.currentTime = target;
    const label = document.createElement('span');
    label.textContent = '10';
    feedback.replaceChildren(playerIcon(delta > 0 ? 'forward' : 'backward'), label);
    feedback.dataset.side = delta > 0 ? 'right' : 'left';
    feedback.setAttribute('aria-label', delta > 0 ? 'Вперёд на 10 секунд' : 'Назад на 10 секунд');
    feedback.classList.add('visible');
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => feedback.classList.remove('visible'), 1000);
  };
  const isMediaTarget = (target: EventTarget | null) => target === media || target === screen;
  screen.addEventListener(
    'click',
    (event) => {
      if (!isMediaTarget(event.target) || Date.now() < ignoreClickUntil) return;
      screen.focus({ preventScroll: true });
      options.toggle();
    },
    { signal: options.signal },
  );
  screen.addEventListener(
    'pointerup',
    (event) => {
      if (!isMediaTarget(event.target) || !['touch', 'pen'].includes(event.pointerType)) return;
      const now = Date.now();
      ignoreClickUntil = now + 600;
      const side =
        event.clientX < screen.getBoundingClientRect().left + screen.clientWidth / 2 ? -1 : 1;
      if (lastTap && now - lastTap.time <= 300 && side === lastTap.side) {
        clearTimeout(tapTimer);
        lastTap = undefined;
        seek(side * 10);
        return;
      }
      clearTimeout(tapTimer);
      lastTap = { time: now, side };
      // Starting playback stays inside the trusted touch event (important for iOS).
      if (media.paused) {
        options.toggle();
        tapTimer = setTimeout(() => {
          lastTap = undefined;
        }, 300);
      } else
        tapTimer = setTimeout(() => {
          lastTap = undefined;
          options.toggle();
        }, 300);
      screen.focus({ preventScroll: true });
    },
    { signal: options.signal },
  );
  screen.addEventListener(
    'keydown',
    (event) => {
      const target = event.target as HTMLElement;
      if (target.closest('input,select,textarea,.player-settings')) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        seek(event.key === 'ArrowRight' ? 10 : -10);
      } else if (event.key.toLowerCase() === 'm') {
        event.preventDefault();
        options.mute();
      } else if (event.code === 'Space' && !target.closest('button')) {
        event.preventDefault();
        options.toggle();
      }
    },
    { signal: options.signal },
  );
  options.signal.addEventListener(
    'abort',
    () => {
      clearTimeout(feedbackTimer);
      clearTimeout(tapTimer);
    },
    { once: true },
  );
}
