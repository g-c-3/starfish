// pdfmarkconst.js — shared by the mark-up screen and the export (Decision 166). No imports, so the screen loads without pdf-lib.

const COLORS = { yellow: [1, 0.92, 0.2], green: [0.45, 0.85, 0.35], pink: [1, 0.55, 0.75], blue: [0.2, 0.45, 0.95], red: [0.85, 0.15, 0.15], black: [0, 0, 0] };
const HIGHLIGHT_COLORS = ['yellow', 'green', 'pink'];
const INK_COLORS = ['blue', 'red', 'black'];
const STAMPS = ['Approved', 'Rejected', 'Draft', 'Paid', 'Received', 'Copy', 'Confidential'];
const HIGHLIGHT_OPACITY = 0.35;
const MAX_MARKS = 2000;
const TEXT_SIZE = 0.022;  // fraction of the page width
const STAMP_SIZE = 0.03;
const PEN_WIDTH = 0.004;
const BASELINE_TEXT = 0.94;  // first baseline below the top of a text box, in text sizes (matches the on-screen box)
const BASELINE_STAMP = 0.84; // baseline below the padding of a stamp box
const STAMP_PAD = 0.35;      // stamp padding, in text sizes

export { COLORS, HIGHLIGHT_COLORS, INK_COLORS, STAMPS, HIGHLIGHT_OPACITY, MAX_MARKS, TEXT_SIZE, STAMP_SIZE, PEN_WIDTH, BASELINE_TEXT, BASELINE_STAMP, STAMP_PAD };
