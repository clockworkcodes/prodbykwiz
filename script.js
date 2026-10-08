/* =========================================================
   ТРЕКИ — вставь сюда свои биты.
   title — название в плеере, src — путь к .mp3
   (файл в репозитории, например "audio/beat-01.mp3", или полная ссылка https://...)
   ========================================================= */
const TRACKS = [
  { title: 'pusillanimous', src: 'audio/pusillanimous.mp3' },
  { title: 'evil ways', src: 'audio/evil-ways.mp3' },
  { title: 'senseless', src: 'audio/senseless.mp3' },
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

  // Анализатор звука для пульса диска и эквалайзера. Слушаем копию потока (captureStream),
  // а сам звук идёт напрямую из <audio>: плеер играет, даже если Web Audio недоступен.
  // Где captureStream нет (Safari, Firefox), диск пульсирует в ровном условном ритме.
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const canAnalyse = typeof audio.captureStream === 'function' && Boolean(AudioCtx);
  let ctx = null;
  let source = null;
  let tappedSrc = '';

  const tapAudio = () => {
    if (!canAnalyse || tappedSrc === audio.src) return;
    try {
      if (!ctx) {
        ctx = new AudioCtx();
        analyser = ctx.createAnalyser();
        analyser.fftSize = 128;
        analyser.smoothingTimeConstant = 0.75;
        bins = new Uint8Array(analyser.frequencyBinCount);
      }
      if (source) source.disconnect();
      source = ctx.createMediaStreamSource(audio.captureStream());
      source.connect(analyser);
      tappedSrc = audio.src;
    } catch (error) {
      // Поток не дали прослушать — останется условный ритм, звук это не затрагивает
    }
  };

  const play = () => {
    if (ctx && ctx.state === 'suspended') ctx.resume();
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
  audio.addEventListener('playing', tapAudio);
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
        return Math.pow(sum / (to - from) / 255, 2.2); // степень растягивает громкие треки, иначе столбики упираются в потолок
      };
      // Пустой спектр — поток не слышен анализатору, тогда ниже включится условный ритм
      if (bins.some((value) => value > 0)) {
        return [band(0, 4), band(1, 5), band(5, 12), band(12, 24), band(24, 44)];
      }
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
  const heroBlocks = document.querySelector('.hero__blocks');
  const aboutCols = document.querySelector('.about__cols');
  if (!main || !heroWrap || !pathWrap || !heroBlocks || !aboutCols) return;

  const HUB_RATIO = 0.12; // радиус втулки в долях радиуса диска (см. .shape__cd в style.css)
  const HUB_MARGIN = 16;

  // Положение по вертикали внутри <main> без учёта transform-анимаций
  const pageY = (el) => {
    let y = 0;
    for (let node = el; node && node !== main; node = node.offsetParent) y += node.offsetTop;
    return y;
  };

  const measure = () => {
    const top = pageY(heroWrap) + heroWrap.offsetHeight * 0.57;
    const bottom = pageY(pathWrap) + pathWrap.offsetHeight * 0.67;
    return { top, size: bottom - top };
  };

  const update = () => {
    // Отверстие диска должно попадать в просвет между текстом первого и второго экрана.
    // Если не помещается — раздвигаем экраны (--hub-space), пока не встанет.
    let space = 0;
    let shape;
    for (let pass = 0; pass < 6; pass++) {
      main.style.setProperty('--hub-space', `${space.toFixed(1)}px`);
      shape = measure();
      const center = shape.top + shape.size / 2;
      const hub = (shape.size / 2) * HUB_RATIO + HUB_MARGIN;
      const above = pageY(heroBlocks) + heroBlocks.offsetHeight;
      const below = pageY(aboutCols);
      const overlap = Math.max(above - (center - hub), center + hub - below);
      if (overlap <= 0) break;
      space += overlap / 0.46 + 1; // сдвиг на s двигает центр на s/2 и чуть увеличивает втулку
    }
    main.style.setProperty('--shape-top', `${shape.top.toFixed(1)}px`);
    main.style.setProperty('--shape-size', `${shape.size.toFixed(1)}px`);
  };

  update();
  new ResizeObserver(update).observe(main);
})();

/* ---------- Мерцающие точки на фоне ---------- */

(function initSparks() {
  document.querySelectorAll('.screen').forEach((screen) => {
    for (let i = 0; i < 20; i++) {
      const spark = document.createElement('span');
      spark.className = i % 3 === 0 ? 'spark spark--twinkle' : 'spark';
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

/* ---------- Диск и курсор: реакция на мышь и на бит ----------
   Один цикл requestAnimationFrame. Меняем только transform (его считает видеокарта,
   без перерисовки) и пишем в стили, только когда значение реально изменилось. */

(function initShapes() {
  if (reduceMotion) return;

  const root = document.documentElement;
  const disc = document.querySelector('.shape__disc');
  const cd = document.querySelector('.shape__cd');
  const toggleBtn = document.querySelector('.player__toggle');
  const eqBars = [...document.querySelectorAll('.player__eq i')];
  const SPIN_SPEED = 0.06; // градусов в миллисекунду на полном ходу (оборот за 6 секунд)

  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const ring = { x: 0, y: 0, tx: 0, ty: 0 };
  let cursor = null;
  let beat = 0;
  let spin = 0; // 0..1: диск плавно раскручивается и останавливается
  let angle = 0;
  let lastTime = 0;
  let lastDisc = '';
  let lastRing = '';
  let lastBeat = '';
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
    }, { passive: true });
    root.addEventListener('pointerleave', () => cursor.classList.remove('is-visible'));
  }

  // Следим за частотой кадров первые секунды. Если устройство не тянет —
  // включаем облегчённый режим (см. .lite в style.css) и больше не проверяем.
  const probe = { frames: 0, slow: 0, skip: 150, done: false };
  const watchFrameRate = (dt) => {
    if (probe.done || document.hidden) return;
    if (probe.skip > 0) return void probe.skip--;
    if (dt > 100) return; // вкладка в фоне или окно перекрыто — это не слабое устройство
    probe.frames++;
    if (dt > 22) probe.slow++;
    if (probe.frames < 180) return;
    probe.done = true;
    if (probe.slow / probe.frames > 0.3) root.classList.add('lite');
  };

  const tick = (now) => {
    const elapsed = lastTime ? now - lastTime : 16;
    const dt = Math.min(64, elapsed);
    lastTime = now;
    watchFrameRate(elapsed);
    const lite = root.classList.contains('lite');

    // Диск: лёгкий сдвиг за курсором и пульс под бас
    const levels = player && player.levels();
    const target = levels ? levels[0] : 0;
    beat += (target - beat) * (target > beat ? 0.5 : 0.12);
    if (!lite) {
      pointer.x += (pointer.tx - pointer.x) * 0.06;
      pointer.y += (pointer.ty - pointer.y) * 0.06;
    }
    const discTransform = `translate3d(${pointer.x.toFixed(1)}px, ${pointer.y.toFixed(1)}px, 0) scale(${(1 + beat * 0.03).toFixed(4)})`;
    if (disc && discTransform !== lastDisc) {
      lastDisc = discTransform;
      disc.style.transform = discTransform;
    }

    // CD крутится, пока играет бит
    spin += ((levels ? 1 : 0) - spin) * 0.025;
    if (cd && spin > 0.002) {
      angle = (angle + spin * SPIN_SPEED * dt) % 360;
      cd.style.transform = `rotate(${angle.toFixed(2)}deg)`;
    }

    // Кольцо за курсором
    if (cursor && !lite) {
      ring.x += (ring.tx - ring.x) * 0.2;
      ring.y += (ring.ty - ring.y) * 0.2;
      const ringTransform = `translate3d(${ring.x.toFixed(1)}px, ${ring.y.toFixed(1)}px, 0)`;
      if (ringTransform !== lastRing) {
        lastRing = ringTransform;
        cursor.style.transform = ringTransform;
      }
    }

    // Кнопка play и эквалайзер
    const beatValue = beat.toFixed(3);
    if (toggleBtn && beatValue !== lastBeat) {
      lastBeat = beatValue;
      toggleBtn.style.setProperty('--beat', beatValue);
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
    .from('.hero .block', { y: 36, autoAlpha: 0, duration: 1.1, stagger: 0.14 }, 0.8);

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
