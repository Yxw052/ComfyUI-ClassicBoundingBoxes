// SPDX-License-Identifier: GPL-3.0-or-later
// Adapted from Comfy-Org/ComfyUI_frontend v1.55.17 src/composables/boundingBoxes/boundingBoxesUtil.ts
// Original geometry/conversion logic; TypeScript annotations removed by Node.js.

const clamp01 = (v        ) => Math.max(0, Math.min(1, v))

function normalizeBox(b        )         {
  let { x, y, w, h } = b
  if (w < 0) {
    x += w
    w = -w
  }
  if (h < 0) {
    y += h
    h = -h
  }
  x = clamp01(x)
  y = clamp01(y)
  w = Math.min(w, 1 - x)
  h = Math.min(h, 1 - y)
  return { ...b, x, y, w: Math.max(0, w), h: Math.max(0, h) }
}

function rectHitTest(
  mx        ,
  my        ,
  x1        ,
  y1        ,
  x2        ,
  y2        ,
  rx        ,
  ry
)                 {
  const h = (cx        , cy        ) =>
    Math.abs(mx - cx) < rx && Math.abs(my - cy) < ry
  if (h(x1, y1)) return 'resize-tl'
  if (h(x2, y1)) return 'resize-tr'
  if (h(x1, y2)) return 'resize-bl'
  if (h(x2, y2)) return 'resize-br'
  if (mx >= x1 && mx <= x2 && Math.abs(my - y1) < ry) return 'resize-t'
  if (mx >= x1 && mx <= x2 && Math.abs(my - y2) < ry) return 'resize-b'
  if (my >= y1 && my <= y2 && Math.abs(mx - x1) < rx) return 'resize-l'
  if (my >= y1 && my <= y2 && Math.abs(mx - x2) < rx) return 'resize-r'
  if (mx >= x1 && mx <= x2 && my >= y1 && my <= y2) return 'move'
  return null
}

export function applyDrag(
  mode         ,
  start        ,
  dx        ,
  dy
)         {
  let { x, y, w, h } = start
  switch (mode) {
    case 'move':
      x += dx
      y += dy
      x = clamp01(Math.min(x, 1 - w))
      y = clamp01(Math.min(y, 1 - h))
      break
    case 'draw':
    case 'resize-br':
      w += dx
      h += dy
      break
    case 'resize-tl':
      x += dx
      y += dy
      w -= dx
      h -= dy
      break
    case 'resize-tr':
      y += dy
      w += dx
      h -= dy
      break
    case 'resize-bl':
      x += dx
      w -= dx
      h += dy
      break
    case 'resize-t':
      y += dy
      h -= dy
      break
    case 'resize-b':
      h += dy
      break
    case 'resize-l':
      x += dx
      w -= dx
      break
    case 'resize-r':
      w += dx
      break
  }
  return mode === 'move'
    ? { ...start, x, y }
    : normalizeBox({ ...start, x, y, w, h })
}

export function boxesAt(
  regions                   ,
  mxN        ,
  myN        ,
  handlePx        ,
  logW        ,
  logH        ,
  activeIdx
)                 {
  const rx = handlePx / Math.max(1, logW)
  const ry = handlePx / Math.max(1, logH)
  const res                 = []
  for (let i = 0; i < regions.length; i++) {
    const b = regions[i]
    const mode = rectHitTest(mxN, myN, b.x, b.y, b.x + b.w, b.y + b.h, rx, ry)
    if (mode) res.push({ index: i, mode })
  }
  const ai = res.findIndex((c) => c.index === activeIdx)
  if (ai > 0) res.unshift(res.splice(ai, 1)[0])
  return res
}

export function tagRects(
  regions                   ,
  logW        ,
  logH        ,
  measureWidth                       ,
  height = 14
)            {
  const placed            = []
  const rects            = []
  const hits = (a         , b         ) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  for (let i = 0; i < regions.length; i++) {
    const b = regions[i]
    const x1 = b.x * logW
    const y1 = b.y * logH
    const x2 = (b.x + b.w) * logW
    const y2 = (b.y + b.h) * logH
    const tag = String(i + 1).padStart(2, '0')
    const w = measureWidth(tag) + 8
    let pick                   = [x1, y1]
    for (const [cx, cy] of [
      [x1, y1],
      [x2 - w, y1],
      [x2 - w, y2 - height],
      [x1, y2 - height]
    ]         ) {
      const candidate          = { x: cx, y: cy, w, h: height, tag }
      if (!placed.some((p) => hits(candidate, p))) {
        pick = [cx, cy]
        break
      }
    }
    const r          = { x: pick[0], y: pick[1], w, h: height, tag }
    placed.push(r)
    rects[i] = r
  }
  return rects
}

export function isBoundingBox(b         )                        {
  return (
    !!b &&
    typeof b === 'object' &&
    'x' in b &&
    typeof b.x === 'number' &&
    'y' in b &&
    typeof b.y === 'number' &&
    'width' in b &&
    typeof b.width === 'number' &&
    'height' in b &&
    typeof b.height === 'number'
  )
}

function normalizeHexColor(color         )                {
  if (typeof color !== 'string') return null
  const hex = color.trim().toLowerCase()
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(hex)
  if (short) {
    return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
  }
  return /^#([0-9a-f]{6}|[0-9a-f]{8})$/.test(hex) ? hex : null
}

function normalizePalette(palette         )           {
  return Array.isArray(palette)
    ? palette.map(normalizeHexColor).filter((c)              => c !== null)
    : []
}

function isRecord(value         )                                   {
  return !!value && typeof value === 'object'
}

export function fromBoundingBoxes(
  boxes                    ,
  width        ,
  height
)           {
  const w = width || 1
  const h = height || 1
  return boxes.filter(isBoundingBox).map((box) => {
    const meta = isRecord(box.metadata) ? box.metadata : {}
    return {
      x: box.x / w,
      y: box.y / h,
      w: box.width / w,
      h: box.height / h,
      type: meta.type === 'text' ? 'text' : 'obj',
      text: typeof meta.text === 'string' ? meta.text : '',
      desc: typeof meta.desc === 'string' ? meta.desc : '',
      palette: normalizePalette(meta.palette)
    }
  })
}

export function toBoundingBoxes(
  regions                   ,
  width        ,
  height
)                {
  return regions.map((r) => ({
    x: Math.round(r.x * width),
    y: Math.round(r.y * height),
    width: Math.round(r.w * width),
    height: Math.round(r.h * height),
    metadata: {
      type: r.type,
      text: r.text,
      desc: r.desc,
      palette: r.palette.slice()
    }
  }))
}
