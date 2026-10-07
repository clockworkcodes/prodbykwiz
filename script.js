/* =========================================================
   ТРЕКИ — вставь сюда свои биты.
   title — название в плеере, src — путь к .mp3
   (файл в репозитории, например "audio/beat-01.mp3", или полная ссылка https://...)
   ========================================================= */
const TRACKS = [
  { title: 'beat 01', src: 'audio/beat-01.mp3' },
  { title: 'beat 02', src: 'audio/beat-02.mp3' },
  { title: 'beat 03', src: 'audio/beat-03.mp3' },
];

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- Цвет гигантских заголовков ----------
   Заголовки наложены через mix-blend-mode: difference.
   Чтобы на фоне они были ровно цвета --title, им нужен цвет (--title + --bg).
   Считаем его из CSS-переменных, поэтому палитру достаточно менять в :root. */

(function syncBlendColor() {
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const probe = document.createElement('span');
  probe.hidden = true;
  document.body.append(probe);

  const toRgb = (cssVar) => {
    probe.style.color = `var(${cssVar})`;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = getComputedStyle(probe).color;
    ctx.fillRect(0, 0, 1, 1);
    return ctx.getImageData(0, 0, 1, 1).data;
  };

  const title = toRgb('--title');
  const bg = toRgb('--bg');
  const blend = [0, 1, 2].map((c) => Math.min(255, title[c] + bg[c]));

  document.documentElement.style.setProperty('--title-blend', `rgb(${blend.join(' ')})`);
  probe.remove();
})();

/* ---------- Аудиоплеер ---------- */

const player = (function initPlayer() {
  const root = document.getElementById('player');
  if (!root || !TRACKS.length) return null;

  const toggleBtn = root.querySelector('[data-action="toggle"]');
  const titleEl = root.querySelector('[data-role="title"]');
  const timeEl = root.querySelector('[data-role="time"]');
  const seek = root.querySelector('[data-role="seek"]');
  const list = root.querySelector('[data-role="list"]');
  const barsEl = root.querySelector('[data-role="bars"]');

  const SEEK_MAX = Number(seek.max);
  const audio = new Audio();
  audio.preload = 'metadata';

  let index = 0;
  let isSeeking = false;
  let hasError = false;

  // Волна вместо полоски прогресса: у каждого трека свой рисунок (по названию)
  const BAR_COUNT = 56;
  const bars = Array.from({ length: BAR_COUNT }, () => barsEl.appendChild(document.createElement('i')));
  let playedBars = -1;

  const drawWave = (seedText) => {
    let seed = [...seedText].reduce((hash, ch) => (hash * 31 + ch.codePointAt(0)) >>> 0, 7);
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    let level = 0.5;
    bars.forEach((bar, i) => {
      level = Math.min(1, Math.max(0.15, level + (random() - 0.5) * 0.7));
      const envelope = 0.55 + 0.45 * Math.sin((i / (BAR_COUNT - 1)) * Math.PI);
      bar.style.setProperty('--h', (level * envelope).toFixed(2));
    });
  };

  const paintBars = (ratio) => {
    const played = Math.round(ratio * BAR_COUNT);
    if (played === playedBars) return;
    playedBars = played;
    bars.forEach((bar, i) => bar.classList.toggle('is-played', i < played));
  };

  let analyser = null;
  let bins = null;

  const formatTime = (seconds) => {
    if (!Number.isFinite(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const render = (current = audio.currentTime) => {
    const duration = audio.duration;
    const ratio = Number.isFinite(duration) && duration > 0 ? current / duration : 0;
    seek.value = Math.round(ratio * SEEK_MAX);
    paintBars(ratio);
    seek.setAttribute('aria-valuetext', `${formatTime(current)} / ${formatTime(duration)}`);
    timeEl.textContent = hasError ? 'file not found' : `${formatTime(current)} / ${formatTime(duration)}`;
  };

  // Список треков (если бит один — список не нужен)
  const chips = TRACKS.length > 1
    ? TRACKS.map((track, i) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'player__chip';
        chip.textContent = track.title;
        chip.addEventListener('click', () => (i === index ? toggle() : load(i, true)));
        list.append(chip);
        return chip;
      })
    : [];

  const load = (i, autoplay = false) => {
    index = (i + TRACKS.length) % TRACKS.length;
    hasError = false;
    audio.src = TRACKS[index].src;
    titleEl.textContent = TRACKS[index].title;
    drawWave(TRACKS[index].title);
    chips.forEach((chip, n) => chip.setAttribute('aria-pressed', String(n === index)));
    render(0);
    if (autoplay) play();
  };

  // Анализатор звука для пульса круга и эквалайзера. Подключаем, только если все
  // треки лежат на этом же сайте: иначе браузер из-за CORS отдаёт тишину.
  const canAnalyse = location.protocol.startsWith('http')
    && TRACKS.every((track) => new URL(track.src, location.href).origin === location.origin);
  let ctx = null;

  const connectAnalyser = () => {
    if (!canAnalyse) return;
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      ctx = new AudioCtx();
      analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.75;
      bins = new Uint8Array(analyser.frequencyBinCount);
      ctx.createMediaElementSource(audio).connect(analyser);
      analyser.connect(ctx.destination);
    } catch (error) {
      analyser = null;
    }
  };

  const play = () => {
    connectAnalyser();
    audio.play().catch(() => setPlaying(false));
  };

  const toggle = () => (audio.paused ? play() : audio.pause());

  const setPlaying = (isPlaying) => {
    root.classList.toggle('is-playing', isPlaying);
    document.body.classList.toggle('is-playing', isPlaying);
    toggleBtn.setAttribute('aria-label', isPlaying ? 'pause' : 'play');
  };

  toggleBtn.addEventListener('click', toggle);

  // Перемотка: пока тянем ползунок — показываем время, по отпусканию — применяем
  seek.addEventListener('input', () => {
    isSeeking = true;
    if (!Number.isFinite(audio.duration)) return;
    render((seek.value / SEEK_MAX) * audio.duration);
  });
  seek.addEventListener('change', () => {
    if (Number.isFinite(audio.duration)) {
      audio.currentTime = (seek.value / SEEK_MAX) * audio.duration;
    }
    isSeeking = false;
    render();
  });

  audio.addEventListener('timeupdate', () => !isSeeking && render());
  audio.addEventListener('loadedmetadata', () => {
    hasError = false;
    render();
  });
  audio.addEventListener('play', () => setPlaying(true));
  audio.addEventListener('pause', () => setPlaying(false));
  audio.addEventListener('ended', () => {
    if (TRACKS.length > 1) load(index + 1, true);
    else render(0);
  });
  audio.addEventListener('error', () => {
    hasError = true;
    setPlaying(false);
    render(0);
    console.warn(`[player] не удалось загрузить: ${TRACKS[index].src}`);
  });

  load(0);

  // Уровни 0..1: [бас, ...4 полосы эквалайзера]. Без анализатора — ровный ритм.
  const levels = () => {
    if (audio.paused) return null;
    if (analyser) {
      analyser.getByteFrequencyData(bins);
      const band = (from, to) => {
        let sum = 0;
        for (let i = from; i < to; i++) sum += bins[i];
        return Math.min(1, (sum / (to - from) / 255) * 1.5);
      };
      return [band(0, 4) / 1.5, band(1, 5), band(5, 12), band(12, 24), band(24, 44)];
    }
    const t = audio.currentTime;
    const kick = Math.pow(Math.abs(Math.sin(t * Math.PI * 2.3)), 6);
    return [kick, kick, 0.5 + 0.4 * Math.sin(t * 9), 0.5 + 0.4 * Math.sin(t * 13 + 1), 0.4 + 0.3 * Math.sin(t * 17 + 2)];
  };

  return { levels };
})();

/* ---------- Один круг на обе секции ----------
   Верх круга проходит через заголовок первого экрана, низ — через фразу второго.
   Размер зависит от высоты контента, поэтому считаем его и пересчитываем при ресайзе. */

(function fitShape() {
  const main = document.querySelector('main');
  const heroWrap = document.querySelector('.hero .overlap');
  const pathWrap = document.querySelector('.about .overlap');
  if (!main || !heroWrap || !pathWrap) return;

  const update = () => {
    const origin = main.getBoundingClientRect().top;
    const hero = heroWrap.getBoundingClientRect();
    const path = pathWrap.getBoundingClientRect();
    const top = hero.top - origin + hero.height * 0.57;
    const bottom = path.top - origin + path.height * 0.67;
    main.style.setProperty('--shape-top', `${top.toFixed(1)}px`);
    main.style.setProperty('--shape-size', `${(bottom - top).toFixed(1)}px`);
  };

  update();
  new ResizeObserver(update).observe(main);
})();

/* ---------- Мерцающие точки на фоне ---------- */

(function initSparks() {
  document.querySelectorAll('.screen').forEach((screen) => {
    for (let i = 0; i < 22; i++) {
      const spark = document.createElement('span');
      spark.className = 'spark';
      spark.setAttribute('aria-hidden', 'true');
      spark.style.left = `${(Math.random() * 100).toFixed(1)}%`;
      spark.style.top = `${(Math.random() * 100).toFixed(1)}%`;
      spark.style.setProperty('--size', `${(1 + Math.random() * 2.5).toFixed(1)}px`);
      spark.style.setProperty('--dur', `${(2 + Math.random() * 4).toFixed(1)}s`);
      spark.style.setProperty('--delay', `${(-Math.random() * 6).toFixed(1)}s`);
      screen.append(spark);
    }
  });
})();

/* ---------- Круги и курсор: реакция на мышь и на бит ---------- */

(function initShapes() {
  if (reduceMotion) return;

  const discs = [...document.querySelectorAll('.shape__disc')];
  const toggleBtn = document.querySelector('.player__toggle');
  const eqBars = [...document.querySelectorAll('.player__eq i')];
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const ring = { x: 0, y: 0, tx: 0, ty: 0 };
  let cursor = null;
  let beat = 0;
  let lastState = '';
  let eqActive = false;

  if (window.matchMedia('(pointer: fine)').matches) {
    cursor = document.createElement('div');
    cursor.className = 'cursor';
    cursor.setAttribute('aria-hidden', 'true');
    document.body.append(cursor);

    window.addEventListener('pointermove', (event) => {
      pointer.tx = (event.clientX / innerWidth - 0.5) * -36;
      pointer.ty = (event.clientY / innerHeight - 0.5) * -28;

      ring.tx = event.clientX;
      ring.ty = event.clientY;
      if (!cursor.classList.contains('is-visible')) {
        ring.x = ring.tx;
        ring.y = ring.ty;
        cursor.classList.add('is-visible');
      }
      const target = event.target;
      cursor.classList.toggle('is-active', Boolean(target.closest && target.closest('a, button, input, .giant .split')));
    });
    document.documentElement.addEventListener('pointerleave', () => cursor.classList.remove('is-visible'));
  }

  const tick = () => {
    pointer.x += (pointer.tx - pointer.x) * 0.06;
    pointer.y += (pointer.ty - pointer.y) * 0.06;

    if (cursor) {
      ring.x += (ring.tx - ring.x) * 0.2;
      ring.y += (ring.ty - ring.y) * 0.2;
      cursor.style.transform = `translate3d(${ring.x.toFixed(1)}px, ${ring.y.toFixed(1)}px, 0)`;
    }

    const levels = player && player.levels();
    const target = levels ? levels[0] : 0;
    beat += (target - beat) * (target > beat ? 0.5 : 0.12);

    // Пишем в стили, только когда что-то реально изменилось
    const state = `${pointer.x.toFixed(1)} ${pointer.y.toFixed(1)} ${beat.toFixed(3)}`;
    if (state !== lastState) {
      lastState = state;
      discs.forEach((disc) => {
        disc.style.setProperty('--mx', pointer.x.toFixed(1));
        disc.style.setProperty('--my', pointer.y.toFixed(1));
        disc.style.setProperty('--beat', beat.toFixed(3));
      });
      if (toggleBtn) toggleBtn.style.setProperty('--beat', beat.toFixed(3));
    }
    if (levels || eqActive) {
      eqActive = Boolean(levels);
      eqBars.forEach((bar, i) => {
        bar.style.setProperty('--level', levels ? Math.max(0.18, levels[i + 1]).toFixed(2) : 0.18);
      });
    }

    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();

/* ---------- Анимации появления и скролла (GSAP) ---------- */

// Режет текст на буквы или слова, не трогая <br>
function splitText(el, byChar) {
  const parts = [];
  [...el.childNodes].forEach((node) => {
    if (node.nodeType !== Node.TEXT_NODE) return;
    const fragment = document.createDocumentFragment();
    const tokens = byChar ? [...node.textContent] : node.textContent.split(/(\s+)/);
    tokens.forEach((token) => {
      if (!token) return;
      if (!token.trim()) return fragment.append(token);
      const span = document.createElement('span');
      span.className = 'split';
      span.textContent = token;
      fragment.append(span);
      parts.push(span);
    });
    node.replaceWith(fragment);
  });
  return parts;
}

(function initMotion() {
  const reveal = () => document.documentElement.classList.remove('is-loading');

  if (!window.gsap || !window.ScrollTrigger || reduceMotion) return reveal();

  gsap.registerPlugin(ScrollTrigger);

  const heroTitle = document.querySelector('.giant--hero');
  const pathTitle = document.querySelector('.giant--path');
  heroTitle.setAttribute('aria-label', heroTitle.textContent);
  const chars = splitText(heroTitle, true);
  chars.forEach((char) => char.setAttribute('aria-hidden', 'true'));
  const words = splitText(pathTitle, false);

  // Буквы заголовка подпрыгивают под курсором (включаем после интро)
  const enableLetterHover = () => {
    chars.forEach((char) => {
      char.addEventListener('pointerenter', () => {
        gsap.timeline()
          .to(char, { yPercent: -14, rotation: gsap.utils.random(-7, 7), duration: 0.2, ease: 'power2.out', overwrite: true })
          .to(char, { yPercent: 0, rotation: 0, duration: 1, ease: 'elastic.out(1, 0.35)' });
      });
    });
  };

  // Интро первого экрана
  gsap.timeline({ defaults: { ease: 'expo.out' }, onStart: reveal, onComplete: enableLetterHover })
    .from('.shape', { yPercent: 12, scale: 0.8, transformOrigin: '50% 0%', duration: 2 })
    .from(chars, { yPercent: 80, rotation: 8, autoAlpha: 0, duration: 1.2, stagger: 0.05 }, 0.2)
    .from('.hero .block', { y: 36, autoAlpha: 0, duration: 1.1, stagger: 0.14 }, 0.8)
    .from('.scroll-cue', { autoAlpha: 0, duration: 1 }, 1.6);

  // Скролл: заголовок тонет в круге, линия смены цвета ползёт по буквам
  gsap.to(heroTitle, {
    yPercent: 45,
    ease: 'none',
    scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: 0.6 },
  });
  gsap.to('.hero__blocks', {
    y: () => -innerHeight * 0.1,
    autoAlpha: 0,
    ease: 'none',
    scrollTrigger: { trigger: '.hero', start: '35% top', end: 'bottom top', scrub: 0.6, invalidateOnRefresh: true },
  });

  // Скролл: фраза второго экрана всплывает из круга на его нижний край
  gsap.from(pathTitle, {
    y: () => -innerHeight * 0.16,
    ease: 'power2.out',
    scrollTrigger: { trigger: '.about', start: 'top bottom', end: 'top top', scrub: 0.6, invalidateOnRefresh: true },
  });

  // Появление второго экрана
  gsap.timeline({
    defaults: { ease: 'expo.out', duration: 1.1 },
    scrollTrigger: { trigger: '.about', start: 'top 40%', once: true },
  })
    .from('.about .block', { y: 36, autoAlpha: 0, stagger: 0.14 })
    .from(words, { yPercent: 70, rotation: 5, autoAlpha: 0, stagger: 0.05 }, 0.15)
    .from('.player', { y: 40, autoAlpha: 0 }, 0.55)
    .from('.contact__text', { y: 24, autoAlpha: 0 }, 0.75)
    .from('.socials li', { y: 24, scale: 0.6, autoAlpha: 0, stagger: 0.08, ease: 'back.out(2)' }, 0.85);

  // Иконки соцсетей тянутся к курсору
  if (window.matchMedia('(pointer: fine)').matches) {
    document.querySelectorAll('.socials__link').forEach((link) => {
      const moveX = gsap.quickTo(link, 'x', { duration: 0.5, ease: 'power3.out' });
      const moveY = gsap.quickTo(link, 'y', { duration: 0.5, ease: 'power3.out' });
      link.addEventListener('pointermove', (event) => {
        const box = link.getBoundingClientRect();
        moveX((event.clientX - box.left - box.width / 2) * 0.35);
        moveY((event.clientY - box.top - box.height / 2) * 0.35);
      });
      link.addEventListener('pointerleave', () => {
        moveX(0);
        moveY(0);
      });
    });
  }

  // Шрифт догружается позже — пересчитываем точки скролла
  if (document.fonts) document.fonts.ready.then(() => ScrollTrigger.refresh());
})();
