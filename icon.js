// Colored rounded tile with 7-row block digits. Same shapes, gap, and cell
// size as the original Grok Usage icon. No webfont: anti-aliased type is
// harder to read at toolbar size.

var GLYPHS = {
  "0": ["###", "#.#", "#.#", "#.#", "#.#", "#.#", "###"],
  "1": ["##.", ".#.", ".#.", ".#.", ".#.", ".#.", "###"],
  "2": ["###", "..#", "..#", "###", "#..", "#..", "###"],
  "3": ["###", "..#", "..#", "###", "..#", "..#", "###"],
  "4": ["#.#", "#.#", "#.#", "###", "..#", "..#", "..#"],
  "5": ["###", "#..", "#..", "###", "..#", "..#", "###"],
  "6": ["###", "#..", "#..", "###", "#.#", "#.#", "###"],
  "7": ["###", "..#", "..#", "..#", ".#.", ".#.", ".#."],
  "8": ["###", "#.#", "#.#", "###", "#.#", "#.#", "###"],
  "9": ["###", "#.#", "#.#", "###", "..#", "..#", "###"],
};

var USAGE_GREEN = [0x50, 0xfa, 0x7b, 255];
var USAGE_PURPLE = [0xbd, 0x93, 0xf9, 255];
var USAGE_RED = [0xff, 0x55, 0x55, 255];
var TILE_INK = [0x11, 0x12, 0x18, 255];
var TILE_EMPTY = [0x62, 0x72, 0xa4, 255];

function lerpColor(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
    255,
  ];
}

function usageColor(percent) {
  var p = Math.max(0, Math.min(100, percent)) / 100;
  if (p <= 0.5) return lerpColor(USAGE_GREEN, USAGE_PURPLE, p / 0.5);
  return lerpColor(USAGE_PURPLE, USAGE_RED, (p - 0.5) / 0.5);
}

function digitsFor(percent) {
  if (percent == null || typeof percent !== "number" || !isFinite(percent)) return null;
  var n = Math.round(percent);
  if (n < 0) n = 0;
  if (n > 99) n = 99;
  return String(n);
}

function fillRect(data, size, x, y, w, h, color) {
  var x0 = Math.max(0, x);
  var y0 = Math.max(0, y);
  var x1 = Math.min(size, x + w);
  var y1 = Math.min(size, y + h);
  for (var py = y0; py < y1; py++) {
    for (var px = x0; px < x1; px++) {
      var i = (py * size + px) * 4;
      data[i] = color[0];
      data[i + 1] = color[1];
      data[i + 2] = color[2];
      data[i + 3] = color[3];
    }
  }
}

function inRoundRect(px, py, size, radius) {
  var rr = Math.min(radius, size / 2);
  var cx = px < rr ? rr : px > size - rr ? size - rr : px;
  var cy = py < rr ? rr : py > size - rr ? size - rr : py;
  var dx = px - cx;
  var dy = py - cy;
  return dx * dx + dy * dy <= rr * rr;
}

function drawUsageTileRGBA(size, percent) {
  var data = new Uint8ClampedArray(size * size * 4);
  var digits = digitsFor(percent);
  var bg = digits == null ? TILE_EMPTY : usageColor(percent);
  var radius = Math.max(1, Math.round(size * 0.08));
  for (var y = 0; y < size; y++) {
    for (var x = 0; x < size; x++) {
      if (!inRoundRect(x + 0.5, y + 0.5, size, radius)) continue;
      var i = (y * size + x) * 4;
      data[i] = bg[0];
      data[i + 1] = bg[1];
      data[i + 2] = bg[2];
      data[i + 3] = 255;
    }
  }
  var glyphs = digits
    ? digits.split("").map(function (ch) {
        return GLYPHS[ch] || GLYPHS["0"];
      })
    : [["###"]];
  var gap = 1;
  var cols = 0;
  for (var g = 0; g < glyphs.length; g++) cols += glyphs[g][0].length;
  cols += gap * Math.max(0, glyphs.length - 1);
  var rows = glyphs[0].length;
  var cell = Math.max(1, Math.min(Math.floor(size / cols), Math.floor(size / rows)));
  var originX = Math.floor((size - cols * cell) / 2);
  var originY = Math.floor((size - rows * cell) / 2);
  var col = 0;
  for (var gi = 0; gi < glyphs.length; gi++) {
    var glyph = glyphs[gi];
    for (var gy = 0; gy < glyph.length; gy++) {
      for (var gx = 0; gx < glyph[gy].length; gx++) {
        if (glyph[gy].charAt(gx) !== "#") continue;
        fillRect(data, size, originX + (col + gx) * cell, originY + gy * cell, cell, cell, TILE_INK);
      }
    }
    col += glyph[0].length + gap;
  }
  return data;
}

function tilesFor(percent) {
  var sizes = [16, 32, 48, 64, 128];
  var imageData = {};
  for (var i = 0; i < sizes.length; i++) {
    var size = sizes[i];
    imageData[size] = drawToolbarIcon(size, percent);
  }
  return imageData;
}

function canvasFor(size) {
  if (typeof document !== "undefined" && document.createElement) {
    var canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    return canvas;
  }
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(size, size);
  return null;
}

function drawToolbarIcon(size, percent) {
  var canvas = canvasFor(size);
  var ctx = canvas ? canvas.getContext("2d") : null;
  if (!ctx || typeof ImageData === "undefined") return new ImageData(drawUsageTileRGBA(size, percent), size, size);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, size, size);
  var digits = digitsFor(percent);
  var bg = digits == null ? TILE_EMPTY : usageColor(percent);
  ctx.fillStyle = "rgb(" + bg[0] + "," + bg[1] + "," + bg[2] + ")";
  var radius = Math.max(1, Math.round(size * 0.08));
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(0, 0, size, size, radius);
  else ctx.rect(0, 0, size, size);
  ctx.fill();
  ctx.fillStyle = "rgb(" + TILE_INK[0] + "," + TILE_INK[1] + "," + TILE_INK[2] + ")";
  var glyphs = digits
    ? digits.split("").map(function (ch) {
        return GLYPHS[ch] || GLYPHS["0"];
      })
    : [["###"]];
  var gap = 1;
  var cols = 0;
  for (var g = 0; g < glyphs.length; g++) cols += glyphs[g][0].length;
  cols += gap * Math.max(0, glyphs.length - 1);
  var rows = glyphs[0].length;
  var cell = Math.max(1, Math.min(Math.floor(size / cols), Math.floor(size / rows)));
  var originX = Math.floor((size - cols * cell) / 2);
  var originY = Math.floor((size - rows * cell) / 2);
  var col = 0;
  for (var gi = 0; gi < glyphs.length; gi++) {
    var glyph = glyphs[gi];
    for (var gy = 0; gy < glyph.length; gy++) {
      for (var gx = 0; gx < glyph[gy].length; gx++) {
        if (glyph[gy].charAt(gx) !== "#") continue;
        ctx.fillRect(originX + (col + gx) * cell, originY + gy * cell, cell, cell);
      }
    }
    col += glyph[0].length + gap;
  }
  return ctx.getImageData(0, 0, size, size);
}
