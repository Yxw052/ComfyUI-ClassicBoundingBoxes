// SPDX-License-Identifier: GPL-3.0-or-later
// Selected unchanged functions from ComfyUI_frontend v1.55.17 src/utils/colorUtil.ts.
// TypeScript annotations removed. See NOTICE.md.
export function hexToRgb(hex        )      {
  let r = 0,
    g = 0,
    b = 0
  if (hex.length === 4 || hex.length === 5) {
    r = parseInt(hex[1] + hex[1], 16)
    g = parseInt(hex[2] + hex[2], 16)
    b = parseInt(hex[3] + hex[3], 16)
  } else if (hex.length === 7 || hex.length === 9) {
    r = parseInt(hex.slice(1, 3), 16)
    g = parseInt(hex.slice(3, 5), 16)
    b = parseInt(hex.slice(5, 7), 16)
  }
  return { r, g, b }
}

export function rgbToHex({ r, g, b }     )         {
  const toHex = (n        ) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

export function hsbToRgb({ h, s, b }     )      {
  // Normalize
  const hh = ((h % 360) + 360) % 360
  const ss = Math.max(0, Math.min(100, s)) / 100
  const vv = Math.max(0, Math.min(100, b)) / 100

  const c = vv * ss
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1))
  const m = vv - c

  let rp        , gp        , bp

  if (hh < 60) {
    rp = c
    gp = x
    bp = 0
  } else if (hh < 120) {
    rp = x
    gp = c
    bp = 0
  } else if (hh < 180) {
    rp = 0
    gp = c
    bp = x
  } else if (hh < 240) {
    rp = 0
    gp = x
    bp = c
  } else if (hh < 300) {
    rp = x
    gp = 0
    bp = c
  } else {
    rp = c
    gp = 0
    bp = x
  }

  return {
    r: Math.floor((rp + m) * 255),
    g: Math.floor((gp + m) * 255),
    b: Math.floor((bp + m) * 255)
  }
}

export function rgbToHsv({ r, g, b }     )



  {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  const s = max === 0 ? 0 : (d / max) * 100
  const v = max * 100

  if (d !== 0) {
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) * 60
        break
      case g:
        h = ((b - r) / d + 2) * 60
        break
      case b:
        h = ((r - g) / d + 4) * 60
        break
    }
  }
  return { h, s, v }
}

export function normalizeHex(value        )                {
  const digits = value.trim().replace(/^#/, '')
  return /^([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(digits) ? `#${digits}` : null
}

export function hexToHsva(hex        )       {
  const normalized = hex.startsWith('#') ? hex : `#${hex}`
  let a = 100
  let hexColor = normalized

  if (normalized.length === 9) {
    a = Math.round((parseInt(normalized.slice(7, 9), 16) / 255) * 100)
    hexColor = normalized.slice(0, 7)
  } else if (normalized.length === 5) {
    const aChar = normalized[4]
    a = Math.round((parseInt(aChar + aChar, 16) / 255) * 100)
    hexColor = normalized.slice(0, 4)
  }

  const rgb = hexToRgb(hexColor)
  const hsv = rgbToHsv(rgb)
  return { ...hsv, a }
}

export function hsvaToHex(hsva      )         {
  const rgb = hsbToRgb({ h: hsva.h, s: hsva.s, b: hsva.v })
  const hex = rgbToHex(rgb)
  if (hsva.a >= 100) return hex.toLowerCase()
  const alphaHex = Math.round((hsva.a / 100) * 255)
    .toString(16)
    .padStart(2, '0')
  return `${hex}${alphaHex}`.toLowerCase()
}
