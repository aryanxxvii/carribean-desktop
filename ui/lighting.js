import { clamp } from './optics';

export function incidentLight(box, scenes, sample) {
  const centerX = (box.left + box.right) / 2;
  const centerY = (box.top + box.bottom) / 2;
  const rgb = [0, 0, 0];
  let energy = 0, weight = 0, directionX = 0, directionY = 0;

  for (const scene of scenes) {
    const clip = scene.clip || scene.viewport;
    if (clip.right <= clip.left || clip.bottom <= clip.top) continue;
    const insetX = Math.min(18, (clip.right - clip.left) / 3);
    const insetY = Math.min(13, (clip.bottom - clip.top) / 3);
    const x = clamp(centerX, clip.left + insetX, clip.right - insetX);
    const y = clamp(centerY, clip.top + insetY, clip.bottom - insetY);
    const dx = x - centerX, dy = y - centerY;
    const distance = Math.hypot(dx, dy);
    const reach = clamp((226 - distance) / 100);
    if (!reach || scene.opacity < .005) continue;
    const color = sample(scene, x, y);
    if (!color) continue;
    const falloff = reach ** 2 / (1 + (distance / 87) ** 2);
    const light = color.emission * falloff * scene.opacity;
    const influence = light * falloff;
    const edge = Math.max(Math.abs(dx) / box.width, Math.abs(dy) / box.height, .5);
    energy += light;
    weight += influence;
    directionX += (.5 + dx / box.width / edge * .57) * influence;
    directionY += (.5 + dy / box.height / edge * .57) * influence;
    for (let channel = 0; channel < 3; channel++) rgb[channel] += color.rgb[channel] * influence;
  }
  return weight ? {
    rgb: rgb.map((channel) => Math.round(channel / weight)),
    light: clamp(energy),
    x: directionX / weight,
    y: directionY / weight
  } : null;
}

function startCanvas(canvas, width, height, density) {
  const pixelsWide = Math.max(1, Math.round(width * density));
  const pixelsHigh = Math.max(1, Math.round(height * density));
  if (canvas.width !== pixelsWide) canvas.width = pixelsWide;
  if (canvas.height !== pixelsHigh) canvas.height = pixelsHigh;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.setTransform(pixelsWide / width, 0, 0, pixelsHigh / height, 0, 0);
  context.clearRect(0, 0, width, height);
  return context;
}

export function paintGlassWindow(canvas, box, scenes, padding) {
  const width = box.width + 2 * padding;
  const height = box.height + 2 * padding;
  const left = box.left - padding;
  const top = box.top - padding;
  const context = startCanvas(canvas, width, height, 1.25);
  if (!context) return;
  for (const scene of scenes) {
    const frame = scene.viewport;
    const clip = scene.clip || frame;
    if (clip.right <= left || clip.left >= left + width || clip.bottom <= top || clip.top >= top + height) continue;
    context.save();
    context.beginPath();
    context.rect(clip.left - left, clip.top - top, clip.right - clip.left, clip.bottom - clip.top);
    context.clip();
    context.beginPath();
    context.roundRect(frame.left - left, frame.top - top, frame.width, frame.height, scene.still ? 22 : 11);
    context.clip();
    context.globalAlpha = scene.opacity * (scene.still ? .75 : 1);
    context.drawImage(scene.image, scene.centerX + scene.offsetX - left, scene.centerY + scene.offsetY - top, scene.width, scene.height);
    context.restore();
  }
}
