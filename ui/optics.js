const namespace = 'http://www.w3.org/2000/svg';
const padding = 17;
const displacementScale = 32;

export const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const smooth = (t) => t * t * (3 - 2 * t);

function svg(tag, attributes) {
  const node = document.createElementNS(namespace, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}

function texture(width, height, radius, refraction) {
  const inset = refraction ? padding : 0;
  const fullWidth = width + 2 * inset;
  const fullHeight = height + 2 * inset;
  const ratio = Math.min(2, (refraction ? 256 : 384) / Math.max(fullWidth, fullHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(fullWidth * ratio));
  canvas.height = Math.max(1, Math.round(fullHeight * ratio));
  const context = canvas.getContext('2d');
  if (!context) return '';
  const pixels = context.createImageData(canvas.width, canvas.height);
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const bevelWidth = Math.min(9, height * .31);

  for (let row = 0; row < canvas.height; row++) {
    const y = (row + .5) * fullHeight / canvas.height - fullHeight / 2;
    for (let column = 0; column < canvas.width; column++) {
      const x = (column + .5) * fullWidth / canvas.width - fullWidth / 2;
      const edgeX = Math.abs(x) - halfWidth + radius;
      const edgeY = Math.abs(y) - halfHeight + radius;
      const cornerX = Math.max(edgeX, 0);
      const cornerY = Math.max(edgeY, 0);
      const corner = Math.hypot(cornerX, cornerY);
      const depth = radius - corner - Math.min(Math.max(edgeX, edgeY), 0);
      const pixel = (row * canvas.width + column) * 4;

      if (!refraction) {
        if (depth <= 0) continue;
        const edge = smooth(clamp(depth / .72));
        const reflection = Math.exp(-(((depth - 1.05) / .64) ** 2));
        pixels.data[pixel + 3] = Math.round(255 * reflection * edge);
        continue;
      }

      let bendX = 0;
      let bendY = 0;
      if (depth > 0) {
        const xWeight = smooth(clamp((edgeX - edgeY) / 4 + .5));
        const nx = Math.sign(x) * (corner ? cornerX / corner : xWeight);
        const ny = Math.sign(y) * (corner ? cornerY / corner : 1 - xWeight);
        const feather = smooth(clamp(depth / 2.4));
        const lip = Math.exp(-(((depth / bevelWidth - .43) / .36) ** 2));
        const bend = feather * lip * Math.min(11.2, height * .26);
        const body = Math.min(3.4, height * .095) * smooth(clamp(depth / bevelWidth));
        const u = x / halfWidth;
        const v = y / halfHeight;
        bendX = -nx * bend + body * (-.71 * u + .19 * Math.sin(3 * v + 1.1 * u));
        bendY = -ny * bend + body * (-.75 * v + .23 * Math.cos(2.7 * u - .7 * v));
      }
      pixels.data[pixel] = Math.round(255 * clamp(.5 + bendX / displacementScale));
      pixels.data[pixel + 1] = Math.round(255 * clamp(.5 + bendY / displacementScale));
      pixels.data[pixel + 2] = 128;
      pixels.data[pixel + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
  return canvas.toDataURL();
}

export function createGlassOptics() {
  const root = svg('svg', { width: '0', height: '0', 'aria-hidden': 'true', class: 'glass-definitions' });
  const defs = svg('defs', {});
  root.append(defs);
  document.body.append(root);
  const shapes = new Map();
  const forElement = new WeakMap();

  function measure(element, { inlineSize, blockSize }) {
    if (inlineSize < 8 || blockSize < 8) return;
    const radius = getComputedStyle(element).borderTopLeftRadius;
    const width = Math.round(inlineSize / 4) * 4;
    const height = Math.round(blockSize / 4) * 4;
    const corner = Math.min(width / 2, height / 2, parseFloat(radius) || 0);
    const key = [width, height, corner].join(':');
    if (!shapes.has(key)) {
      const mask = texture(width, height, corner, false);
      shapes.set(key, { width, height, corner, mask });
    }
    const shape = shapes.get(key);
    if (forElement.get(element) !== shape) {
      forElement.set(element, shape);
      if (shape.mask) element.style.setProperty('--glass-reflections', 'url("' + shape.mask + '")');
    }
    element.style.setProperty('--glass-corner', radius);
  }

  function refractionFor(element, reflective = false) {
    const shape = forElement.get(element);
    if (!shape) return '';
    const variant = reflective ? 'reflectiveFilter' : 'filterUrl';
    if (shape[variant] !== undefined) return shape[variant];
    shape.map ??= texture(shape.width, shape.height, shape.corner, true);
    if (!shape.map) return '';
    const id = 'glass-refraction-' + defs.children.length;
    const filter = svg('filter', { id, x: '0%', y: '0%', width: '100%', height: '100%', 'color-interpolation-filters': 'sRGB' });
    filter.append(
      svg('feImage', { href: shape.map, width: '100%', height: '100%', preserveAspectRatio: 'none', result: 'surface' }),
      svg('feDisplacementMap', { in: 'SourceGraphic', in2: 'surface', xChannelSelector: 'R', yChannelSelector: 'G',
        scale: displacementScale, result: 'refracted' })
    );
    if (reflective) filter.append(svg('feBlend', { in: 'refracted', in2: 'SourceGraphic', mode: 'lighten' }));
    defs.append(filter);
    shape[variant] = 'url(#' + id + ')';
    return shape[variant];
  }
  return { measure, refractionFor, padding };
}

export function artworkProjection(node, image) {
  const viewport = (image.closest('.poster-action') || image).getBoundingClientRect();
  if (!viewport.width || !viewport.height) return null;
  const cover = Math.max(viewport.width / image.naturalWidth, viewport.height / image.naturalHeight);
  const width = image.naturalWidth * cover;
  const height = image.naturalHeight * cover;
  const position = getComputedStyle(image).objectPosition.split(' ').map((value) => parseFloat(value) / 100);
  const centerX = viewport.left + viewport.width / 2;
  const centerY = viewport.top + viewport.height / 2;
  const offsetX = viewport.left - centerX + (viewport.width - width) * (Number.isFinite(position[0]) ? position[0] : .5);
  const offsetY = viewport.top - centerY + (viewport.height - height) * (Number.isFinite(position[1]) ? position[1] : .5);
  return { node, image, viewport, width, height, centerX, centerY, offsetX, offsetY };
}
