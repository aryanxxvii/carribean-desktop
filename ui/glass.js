import { artworkProjection, clamp, createGlassOptics } from './optics';
import { incidentLight, paintGlassWindow } from './lighting';

const artSource = '[data-art-source]';
const neutral = [220, 220, 220];

function artworkPainter() {
  const swatches = new WeakMap();
  const canvas = document.createElement('canvas');
  const width = 72;
  const height = 96;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const read = (image) => {
    if (!image?.naturalWidth) return null;
    const known = swatches.get(image);
    if (known?.url === image.currentSrc) return known.pixels;
    let pixels = null;
    if (context) {
      try {
        // Reset the scratch canvas because an earlier remote image can taint it.
        canvas.width = width;
        context.drawImage(image, 0, 0, width, height);
        pixels = context.getImageData(0, 0, width, height).data;
      } catch {}
    }
    swatches.set(image, { url: image.currentSrc, pixels });
    return pixels;
  };

  function sample(source, screenX, screenY) {
    const pixels = read(source.image);
    if (!pixels) return null;
    const u = clamp((screenX - source.centerX - source.offsetX) / source.width);
    const v = clamp((screenY - source.centerY - source.offsetY) / source.height);
    const x = Math.round(u * (width - 1));
    const y = Math.round(v * (height - 1));
    const values = [0, 0, 0];
    let energy = 0;
    let samples = 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const start = (clamp(x + dx * 3, 0, width - 1) + clamp(y + dy * 5, 0, height - 1) * width) * 4;
        const brightness = .21 * pixels[start] + .72 * pixels[start + 1] + .07 * pixels[start + 2];
        const weight = .35 + brightness / 255;
        for (let channel = 0; channel < 3; channel++) values[channel] += pixels[start + channel] * weight;
        energy += brightness * weight;
        samples += weight;
      }
    }
    const channels = values.map((value) => value / samples);
    const gain = Math.min(1.32, 237 / Math.max(...channels));
    const rgb = channels.map((channel) => Math.round(channel * gain + 18));
    const emission = Math.sqrt(energy / samples / 255);
    return { rgb, emission, intensity: .28 + .72 * emission };
  }
  return sample;
}

const px = (number) => Math.round(number * 100) / 100 + 'px';

export function mountGlass() {
  const optics = createGlassOptics();
  const visibleArt = new Set();
  const glassSurfaces = new Set();
  const sampleArtwork = artworkPainter();
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const reduceTransparency = matchMedia('(prefers-reduced-transparency: reduce)');
  const resize = new ResizeObserver((entries) => {
    for (const { target, borderBoxSize } of entries) {
      if (borderBoxSize[0]) optics.measure(target, borderBoxSize[0]);
    }
    scheduleLight();
  });

  let lightFrame = 0;
  function scheduleLight() {
    if (!lightFrame) lightFrame = requestAnimationFrame(updateLight);
  }
  const artObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) visibleArt.add(entry.target);
      else visibleArt.delete(entry.target);
    }
    scheduleLight();
  });
  const projections = new WeakMap();
  const sceneSurfaces = new Map();
  function paintArtwork(surface, source, left, top) {
    const filter = source && optics.refractionFor(surface, true);
    if (!filter) {
      if (projections.has(surface)) {
        delete surface.dataset.lensArt;
        projections.delete(surface);
      }
      return;
    }
    const frame = source.viewport;
    // The filter receives a padded copy of the picture and its shading.
    // Browser-composited content and selection overlays never enter the lens.
    const values = {
      '--glass-image': 'url(' + JSON.stringify(source.image.currentSrc) + ')',
      '--glass-refraction': filter,
      '--glass-padding': px(optics.padding),
      '--glass-frame-width': px(frame.width),
      '--glass-frame-height': px(frame.height),
      '--glass-frame-x': px(frame.left - left),
      '--glass-frame-y': px(frame.top - top),
      '--glass-image-width': px(source.width),
      '--glass-image-height': px(source.height),
      '--glass-image-x': px(source.centerX - left),
      '--glass-image-y': px(source.centerY - top),
      '--glass-image-offset-x': px(source.offsetX),
      '--glass-image-offset-y': px(source.offsetY),
      '--glass-scene-opacity': source.opacity.toFixed(3)
    };
    const before = projections.get(surface) || {};
    for (const [name, value] of Object.entries(values)) {
      if (before[name] !== value) surface.style.setProperty(name, value);
    }
    if (!projections.has(surface)) surface.dataset.lensArt = '';
    projections.set(surface, values);
  }

  function updateLight() {
    lightFrame = 0;
    let changingSlide = false;
    const scenes = [];
    const fadingScenes = [];
    for (const node of visibleArt) {
      const still = node.classList.contains('spotlight');
      if (still) {
        for (const outgoing of node.querySelectorAll('.spotlight-art[data-current="false"] .spotlight-image')) {
          if (!outgoing.naturalWidth || outgoing.hidden) continue;
          const opacity = Number(getComputedStyle(outgoing.parentElement).opacity);
          if (opacity < .005) continue;
          const scene = artworkProjection(node, outgoing);
          if (scene) fadingScenes.push({ ...scene, still, opacity });
          changingSlide = true;
        }
      }
      const image = node.querySelector('[data-glass-art]');
      if (!image?.naturalWidth || image.hidden) continue;
      const scene = artworkProjection(node, image);
      if (!scene) continue;
      scene.still = still;
      scene.opacity = scene.still ? Number(getComputedStyle(image.parentElement).opacity) : 1;
      const shelf = node.closest('.shelf-track')?.getBoundingClientRect();
      if (shelf) scene.clip = {
        left: Math.max(scene.viewport.left, shelf.left), right: Math.min(scene.viewport.right, shelf.right),
        top: Math.max(scene.viewport.top, shelf.top), bottom: Math.min(scene.viewport.bottom, shelf.bottom)
      };
      changingSlide ||= scene.opacity < .999;
      scenes.push(scene);
    }
    const byNode = new Map(scenes.map((scene) => [scene.node, scene]));
    const workspaceScenes = [...fadingScenes, ...scenes].filter((scene) => scene.node.closest('.workspace'));
    const sidebar = document.querySelector('.sidebar');
    const paints = [];
    for (const surface of glassSurfaces) {
      const direct = surface.closest(artSource);
      const inherited = direct && direct !== surface && byNode.get(direct);
      const ambient = surface.hasAttribute('data-ambient') || sidebar?.contains(surface)
        || surface.matches('.page-heading .top-search, .discover-bar .top-search');
      if (!inherited && !ambient) {
        if (projections.has(surface)) paints.push({ surface });
        continue;
      }
      const box = surface.getBoundingClientRect();
      if (box.bottom < -15 || box.top > innerHeight + 15 || !box.width || !box.height) continue;
      const centerX = box.left + box.width / 2;
      const centerY = box.top + box.height / 2;
      const detailArt = surface.matches('.film-dialog .dialog-inner') && byNode.get(surface.querySelector('.film-detail-art'));
      const frame = inherited?.viewport;
      const overArtwork = frame && centerX >= frame.left && centerX <= frame.right && centerY >= frame.top && centerY <= frame.bottom;
      const directLight = inherited && sampleArtwork(inherited, centerX, centerY);
      const reflectedLight = ambient && !directLight && incidentLight(box, detailArt ? [detailArt] : workspaceScenes, sampleArtwork);
      paints.push({
        surface,
        rgb: directLight?.rgb || reflectedLight?.rgb || neutral,
        light: directLight ? directLight.intensity * (overArtwork ? 1 : .42) : reflectedLight?.light || 0,
        x: reflectedLight?.x ?? .5,
        y: reflectedLight?.y ?? .5,
        source: overArtwork ? inherited : null,
        left: centerX - surface.offsetWidth / 2, top: centerY - surface.offsetHeight / 2
      });
    }
    const effects = reduceTransparency.matches ? [] : [...sceneSurfaces].map(([surface, canvas]) => ({
      surface, canvas, box: surface.getBoundingClientRect()
    }));
    for (const { surface, rgb, light, x, y, source, left, top } of paints) {
      paintArtwork(surface, source, left, top);
      if (!rgb) continue;
      surface.style.setProperty('--scene-color', 'rgb(' + rgb.join(' ') + ')');
      surface.style.setProperty('--scene-light', light.toFixed(3));
      surface.style.setProperty('--scene-x', (x * 100).toFixed(1) + '%');
      surface.style.setProperty('--scene-y', (y * 100).toFixed(1) + '%');
    }
    for (const { surface, canvas, box } of effects) {
      if (!box.width || !box.height || box.bottom < 0 || box.top > innerHeight) continue;
      const filter = optics.refractionFor(surface);
      if (filter && canvas.style.filter !== filter) canvas.style.filter = filter;
      paintGlassWindow(canvas, box, workspaceScenes, optics.padding);
    }
    if (changingSlide) scheduleLight();
  }

  const selector = '.glass, ' + artSource;
  function visit(tree, callback) {
    if (tree.nodeType !== 1) return;
    if (tree.matches(selector)) callback(tree);
    tree.querySelectorAll(selector).forEach(callback);
  }
  function watch(node) {
    if (node.matches(artSource)) artObserver.observe(node);
    if (node.classList.contains('glass')) {
      glassSurfaces.add(node);
      resize.observe(node);
      const canvas = node.querySelector(':scope > .glass-window');
      if (canvas) sceneSurfaces.set(node, canvas);
    }
  }
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.removedNodes.forEach((node) => visit(node, (element) => {
        if (!element.isConnected) {
          glassSurfaces.delete(element);
          sceneSurfaces.delete(element);
          visibleArt.delete(element);
          artObserver.unobserve(element);
          resize.unobserve(element);
        }
      }));
      mutation.addedNodes.forEach((node) => visit(node, watch));
    }
    scheduleLight();
  });
  const app = document.getElementById('root');
  observer.observe(app, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-current', 'data-glass-art'] });
  visit(app, watch);
  document.addEventListener('load', (event) => { if (event.target.matches?.('[data-glass-art]')) scheduleLight(); }, true);
  window.addEventListener('scroll', scheduleLight, { capture: true, passive: true });
  window.addEventListener('resize', scheduleLight, { passive: true });
  reduceTransparency.addEventListener('change', scheduleLight);

  const motion = new Map();
  const home = { x: .15, y: .02, glow: 0, pressure: 0 };
  let contacts = new Set();
  let pressed = null;
  let motionFrame = 0;
  let lastTime = 0;
  const start = () => { if (!motionFrame && !reduceMotion.matches) motionFrame = requestAnimationFrame(tick); };
  const channel = (value) => ({ value, end: value, speed: 0 });
  function getMotion(node) {
    if (!motion.has(node)) {
      motion.set(node, Object.fromEntries(Object.entries(home).map(([name, value]) => [name, channel(value)])));
    }
    return motion.get(node);
  }
  function spring(state, seconds, strength, damping) {
    state.speed += ((state.end - state.value) * strength - state.speed * damping) * seconds;
    state.value += state.speed * seconds;
    if (Math.abs(state.end - state.value) < .002 && Math.abs(state.speed) < .024) {
      state.value = state.end;
      state.speed = 0;
      return false;
    }
    return true;
  }
  function tick(now) {
    const interval = Math.min(.018, lastTime ? (now - lastTime) / 1000 : .016);
    lastTime = now;
    motionFrame = 0;
    let moving = false;
    for (const [node, state] of motion) {
      if (!node.isConnected) { motion.delete(node); continue; }
      const movingX = spring(state.x, interval, 195, 23);
      const movingY = spring(state.y, interval, 195, 23);
      const glowing = spring(state.glow, interval, 130, 19);
      const pressing = spring(state.pressure, interval, 260, 22);
      node.style.setProperty('--gx', (state.x.value * 100).toFixed(2) + '%');
      node.style.setProperty('--gy', (state.y.value * 100).toFixed(2) + '%');
      node.style.setProperty('--energy', clamp(state.glow.value).toFixed(3));
      node.style.setProperty('--press', clamp(state.pressure.value, -.12, 1).toFixed(3));
      if (!(movingX || movingY || glowing || pressing)) {
        if (!contacts.has(node) && node !== pressed) motion.delete(node);
      } else moving = true;
    }
    if (moving) start();
    else lastTime = 0;
  }
  function move(event) {
    if (reduceMotion.matches) return;
    const next = new Set();
    // A text drag can pass over a lens without activating the control.
    let surface = !event.buttons || pressed ? event.target.closest?.('.glass') : null;
    while (surface && next.size < 2) {
      const box = surface.getBoundingClientRect();
      if (box.width && box.height) {
        const state = getMotion(surface);
        state.x.end = clamp((event.clientX - box.left) / box.width, -.16, 1.16);
        state.y.end = clamp((event.clientY - box.top) / box.height, -.16, 1.16);
        state.glow.end = next.size ? .38 : .82;
        next.add(surface);
      }
      surface = surface.parentElement?.closest('.glass');
    }
    for (const node of contacts) {
      if (next.has(node)) continue;
      const state = getMotion(node);
      state.x.end = home.x;
      state.y.end = home.y;
      state.glow.end = 0;
    }
    contacts = next;
    start();
  }
  function release() {
    if (pressed) getMotion(pressed).pressure.end = 0;
    pressed = null;
    start();
  }
  document.addEventListener('pointermove', move, { passive: true });
  document.addEventListener('pointerdown', (event) => {
    if (reduceMotion.matches) return;
    pressed = event.target.closest?.('button.glass:not(:disabled)');
    if (pressed) {
      move(event);
      getMotion(pressed).pressure.end = event.pointerType === 'touch' ? 1 : .66;
      start();
    }
  }, { passive: true });
  document.addEventListener('pointerup', release, { passive: true });
  document.addEventListener('pointercancel', release, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => {
    for (const node of contacts) {
      const state = getMotion(node);
      state.x.end = home.x;
      state.y.end = home.y;
      state.glow.end = 0;
    }
    contacts = new Set();
    release();
  });
}
