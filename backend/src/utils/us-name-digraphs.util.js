'use strict';

/**
 * US-oriented 2-letter name digraphs for live ARRT search planning.
 *
 * ARRT matches literal substrings (not wildcards). Blind aa–zz × aa–zz is 676²
 * pairs and includes junk like "xx" / "xz". This module:
 *   1. generates every lowercase digraph;
 *   2. keeps only digraphs that are plausible in US given names / surnames;
 *   3. ranks them so high-yield pairs are searched first.
 */

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'y']);

/**
 * Consonant digraphs that appear in US names without a vowel in the pair
 * (e.g. Christopher, Smith, Wright, Mc- names use "mc" with a following vowel
 * in the full name, but "ch"/"th"/"sm" are themselves vowel-free).
 */
const CONSONANT_DIGRAPHS = new Set([
  'bl',
  'br',
  'ch',
  'ck',
  'cl',
  'cr',
  'ct',
  'cz',
  'dh',
  'dr',
  'fl',
  'fr',
  'gh',
  'gl',
  'gr',
  'kh',
  'kn',
  'kr',
  'ld',
  'll',
  'lm',
  'ln',
  'lp',
  'lt',
  'mb',
  'mc',
  'mp',
  'nd',
  'ng',
  'nk',
  'nn',
  'nt',
  'ph',
  'pl',
  'pr',
  'ps',
  'pt',
  'rc',
  'rd',
  'rk',
  'rl',
  'rm',
  'rn',
  'rp',
  'rr',
  'rs',
  'rt',
  'rv',
  'rz',
  'sc',
  'sh',
  'sk',
  'sl',
  'sm',
  'sn',
  'sp',
  'ss',
  'st',
  'sv',
  'sw',
  'sz',
  'th',
  'tr',
  'ts',
  'tt',
  'tw',
  'tz',
  'wh',
  'wr',
  'zh',
]);

/**
 * Digraphs that are linguistically possible but almost never useful as US name
 * search fragments (filler / non-name noise).
 */
const BLOCKED_DIGRAPHS = new Set([
  'aa', // rare as a standalone fragment vs Aaron covered by "ar"/"on"
  'bx',
  'cj',
  'cx',
  'dx',
  'eq',
  'fj',
  'fx',
  'gq',
  'gx',
  'hx',
  'iq',
  'ix',
  'jb',
  'jc',
  'jd',
  'jf',
  'jg',
  'jh',
  'jj',
  'jk',
  'jl',
  'jm',
  'jn',
  'jp',
  'jq',
  'jr',
  'js',
  'jt',
  'jv',
  'jw',
  'jx',
  'jy',
  'jz',
  'kq',
  'kx',
  'lx',
  'mq',
  'mx',
  'nq',
  'nx',
  'pq',
  'px',
  'qb',
  'qc',
  'qd',
  'qe',
  'qf',
  'qg',
  'qh',
  'qi',
  'qj',
  'qk',
  'ql',
  'qm',
  'qn',
  'qo',
  'qp',
  'qq',
  'qr',
  'qs',
  'qt',
  'qv',
  'qw',
  'qx',
  'qy',
  'qz',
  'sx',
  'tq',
  'tx',
  'uq',
  'vb',
  'vc',
  'vd',
  'vf',
  'vg',
  'vh',
  'vj',
  'vk',
  'vm',
  'vn',
  'vp',
  'vq',
  'vt',
  'vv',
  'vw',
  'vx',
  'vz',
  'wq',
  'wx',
  'xj',
  'xk',
  'xq',
  'xr',
  'xs',
  'xt',
  'xu',
  'xv',
  'xw',
  'xx',
  'xy',
  'xz',
  'yq',
  'yx',
  'zb',
  'zc',
  'zd',
  'zf',
  'zg',
  'zj',
  'zk',
  'zm',
  'zn',
  'zp',
  'zq',
  'zr',
  'zs',
  'zt',
  'zv',
  'zw',
  'zx',
  'zz',
]);

/**
 * Higher = searched earlier. Biased toward digraphs that show up in common
 * US given names and surnames (and the proven live pair "ch"/"ad").
 */
const DIGRAPH_PRIORITY = Object.freeze({
  ch: 100,
  th: 95,
  sh: 90,
  ph: 85,
  wh: 80,
  an: 78,
  ar: 77,
  er: 76,
  on: 75,
  en: 74,
  in: 73,
  el: 72,
  al: 71,
  le: 70,
  la: 69,
  ri: 68,
  ro: 67,
  ra: 66,
  ma: 65,
  me: 64,
  mi: 63,
  mo: 62,
  ja: 61,
  je: 60,
  jo: 59,
  ju: 58,
  ka: 57,
  ke: 56,
  ki: 55,
  ko: 54,
  da: 53,
  de: 52,
  di: 51,
  do: 50,
  br: 49,
  tr: 48,
  st: 47,
  sm: 46,
  sn: 45,
  cr: 44,
  cl: 43,
  gr: 42,
  fr: 41,
  pr: 40,
  ad: 98,
  am: 70,
  as: 69,
  at: 68,
  au: 67,
  ay: 66,
  be: 65,
  bi: 64,
  bo: 63,
  bu: 62,
  ca: 72,
  ce: 60,
  ci: 59,
  co: 71,
  cu: 55,
  ed: 68,
  eg: 50,
  ei: 55,
  em: 70,
  es: 65,
  et: 60,
  ev: 62,
  ew: 58,
  ey: 57,
  fa: 55,
  fe: 54,
  fi: 53,
  fo: 52,
  fu: 40,
  ga: 58,
  ge: 60,
  gi: 55,
  go: 54,
  gu: 50,
  ha: 70,
  he: 68,
  hi: 60,
  ho: 62,
  hu: 55,
  ia: 60,
  ie: 58,
  il: 55,
  im: 54,
  ir: 56,
  is: 65,
  it: 60,
  iv: 45,
  ll: 70,
  lo: 65,
  lu: 58,
  ly: 55,
  mc: 80,
  na: 70,
  ne: 68,
  ni: 65,
  no: 64,
  nu: 45,
  ny: 50,
  ol: 60,
  om: 55,
  or: 72,
  os: 58,
  ot: 50,
  ou: 55,
  ow: 54,
  pa: 68,
  pe: 65,
  pi: 55,
  po: 58,
  pu: 40,
  qu: 70,
  re: 72,
  ru: 55,
  ry: 60,
  sa: 70,
  se: 65,
  si: 62,
  so: 60,
  su: 58,
  ta: 65,
  te: 64,
  ti: 62,
  to: 63,
  tu: 45,
  ty: 55,
  ul: 50,
  um: 45,
  un: 55,
  ur: 58,
  us: 50,
  va: 60,
  ve: 58,
  vi: 62,
  vo: 45,
  wa: 60,
  we: 58,
  wi: 70,
  wo: 50,
  ya: 50,
  ye: 45,
  yo: 48,
  yu: 40,
  za: 45,
  ze: 42,
  zi: 40,
  zo: 40,
});

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

/**
 * @param {string} digraph
 * @returns {boolean}
 */
function isPlausibleUsNameDigraph(digraph) {
  if (typeof digraph !== 'string') {
    return false;
  }

  const value = digraph.trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(value)) {
    return false;
  }

  if (BLOCKED_DIGRAPHS.has(value)) {
    return false;
  }

  // "q" in US names is almost always "qu" (Quinn, Nguyen is "ng").
  if (value.includes('q') && value !== 'qu') {
    return false;
  }

  const [first, second] = value;
  const hasVowel = VOWELS.has(first) || VOWELS.has(second);
  if (hasVowel) {
    return true;
  }

  return CONSONANT_DIGRAPHS.has(value);
}

/**
 * All plausible lowercase US name digraphs, highest priority first.
 *
 * @returns {string[]}
 */
function listUsNameDigraphs() {
  const digraphs = [];

  for (const first of LETTERS) {
    for (const second of LETTERS) {
      const digraph = `${first}${second}`;
      if (isPlausibleUsNameDigraph(digraph)) {
        digraphs.push(digraph);
      }
    }
  }

  digraphs.sort((left, right) => {
    const priorityDelta =
      (DIGRAPH_PRIORITY[right] || 0) - (DIGRAPH_PRIORITY[left] || 0);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }
    return left.localeCompare(right);
  });

  return digraphs;
}

/**
 * Digraphs biased toward US given-name fragments (same filter, priority order).
 * @returns {string[]}
 */
function listUsFirstNameDigraphs() {
  return listUsNameDigraphs();
}

/**
 * Digraphs biased toward US surname fragments (includes mc/sz/cz via filter).
 * @returns {string[]}
 */
function listUsLastNameDigraphs() {
  return listUsNameDigraphs();
}

/**
 * Priority for sorting search pairs. Unknown digraphs score 0.
 *
 * @param {string} digraph
 * @returns {number}
 */
function digraphPriority(digraph) {
  if (typeof digraph !== 'string') {
    return 0;
  }
  return DIGRAPH_PRIORITY[digraph.trim().toLowerCase()] || 0;
}

module.exports = {
  VOWELS,
  CONSONANT_DIGRAPHS,
  BLOCKED_DIGRAPHS,
  isPlausibleUsNameDigraph,
  listUsNameDigraphs,
  listUsFirstNameDigraphs,
  listUsLastNameDigraphs,
  digraphPriority,
};
