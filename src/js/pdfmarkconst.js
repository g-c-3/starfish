// pdfmarkconst.js — shared by the mark-up screen and the export (Decisions 166, 362). No imports, so the screen loads without pdf-lib.

const COLORS = {
  yellow: [1, 0.92, 0.2], green: [0.45, 0.85, 0.35], pink: [1, 0.55, 0.75], orange: [1, 0.62, 0.15], cyan: [0.3, 0.85, 0.95], lilac: [0.75, 0.55, 1],
  blue: [0.2, 0.45, 0.95], red: [0.85, 0.15, 0.15], black: [0, 0, 0], teal: [0.05, 0.55, 0.5], purple: [0.5, 0.2, 0.8], brown: [0.5, 0.3, 0.15]
};
const HIGHLIGHT_COLORS = ['yellow', 'green', 'pink', 'orange', 'cyan', 'lilac'];
const INK_COLORS = ['blue', 'red', 'black', 'teal', 'purple', 'orange', 'brown'];
const STAMPS = ['Approved', 'Rejected', 'Draft', 'Paid', 'Received', 'Copy', 'Confidential'];
const STAMP_SHAPES = [['rect', 'Rectangle'], ['round', 'Rounded'], ['oval', 'Oval'], ['circle', 'Circle']];
const STAMP_MAX_LABEL = 24;
const HIGHLIGHT_OPACITY = 0.35;
const MAX_MARKS = 2000;
const TEXT_SIZE = 0.022;  // fraction of the page width
const STAMP_SIZE = 0.03;
const PEN_WIDTH = 0.004;
const FS_MIN = 0.008, FS_MAX = 0.2; // text and stamp size limits, fraction of the page width
const BASELINE_TEXT = 0.94;  // first baseline below the top of a text box, in text sizes (matches the on-screen box)
const STAMP_PAD = 0.35;      // rectangle and rounded padding, in text sizes
const STAMP_BORDER = 0.1;    // stamp outline thickness, in text sizes
const STAMP_BASELINE = 0.34; // text baseline below the stamp's centre, in text sizes
const SIGN_DEFAULT_W = 0.25; // a new picture is medium: this fraction of the page width
const SIGN_W_MIN = 0.03, SIGN_W_MAX = 1;
const SIGN_MIN_ALPHA = 0.1;
const SIGN_MAX_SIDE = 900;   // longest side of the picture kept, in pixels

// Outer size of a stamp in text sizes (outline included) for a text `twEm` text sizes wide. One rule for screen and export.
function stampGeometry(shape, twEm) {
  let w, h, radius = 0;
  if (shape === 'oval') { w = (twEm + 0.6) * 1.3; h = 2.1; }
  else if (shape === 'circle') { w = h = Math.hypot(twEm, 1) + 0.8; }
  else { w = twEm + 2 * STAMP_PAD; h = 1 + 2 * STAMP_PAD; if (shape === 'round') radius = 0.45; }
  return { w: w + STAMP_BORDER, h: h + STAMP_BORDER, t: STAMP_BORDER, radius, ellipse: shape === 'oval' || shape === 'circle' };
}

export { COLORS, HIGHLIGHT_COLORS, INK_COLORS, STAMPS, STAMP_SHAPES, STAMP_MAX_LABEL, HIGHLIGHT_OPACITY, MAX_MARKS, TEXT_SIZE, STAMP_SIZE, PEN_WIDTH, FS_MIN, FS_MAX, BASELINE_TEXT, STAMP_PAD, STAMP_BORDER, STAMP_BASELINE, SIGN_DEFAULT_W, SIGN_W_MIN, SIGN_W_MAX, SIGN_MIN_ALPHA, SIGN_MAX_SIDE, stampGeometry };
