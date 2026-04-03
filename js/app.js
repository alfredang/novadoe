/* ============================================================
   STATE
   ============================================================ */
const state = {
  doeType: 'full-factorial',
  ccdSubType: 'face-centered',
  factors: [],
  config: {
    resolution: 'III',
    fraction: '1/2',
    numSamples: 20,
    centerPoints: 1,
    randomSeed: 42,
    replicates: 1,
    randomize: false,
  },
  matrix: [],
  centerPointRows: new Set(),
  sortCol: -1,
  sortAsc: true,
  searchQuery: '',
  currentPage: 1,
  rowsPerPage: 50,
};

/* ============================================================
   DOE TYPE DEFINITIONS
   ============================================================ */
const DOE_TYPES = [
  { id: 'full-factorial', name: 'Full Factorial', desc: 'All factor combinations', info: 'Tests every possible combination of factor levels. Best for understanding all main effects and interactions when the number of factors and levels is small.' },
  { id: 'fractional-factorial', name: 'Fractional Factorial', desc: 'Subset of combinations', info: 'Uses a carefully chosen fraction of the full factorial design. Efficient for screening many factors when some higher-order interactions can be assumed negligible.' },
  { id: 'plackett-burman', name: 'Plackett-Burman', desc: 'Screening design', info: 'Highly efficient screening design for identifying the most important factors. Uses N runs (multiple of 4) to study up to N-1 factors, but cannot estimate interactions.' },
  { id: 'box-behnken', name: 'Box-Behnken', desc: 'Response surface (3-level)', info: 'A 3-level response surface design that avoids extreme corners. Requires 3–7 factors, all at 3 levels. Does not include runs where all factors are at their extremes simultaneously.' },
  { id: 'central-composite', name: 'Central Composite', desc: 'Response surface + star', info: 'Combines a factorial design with axial (star) points and center points for fitting second-order response surfaces. Three variants control the position of star points.' },
  { id: 'latin-hypercube', name: 'Latin Hypercube', desc: 'Space-filling sample', info: 'Stratified random sampling that ensures each factor range is evenly covered. Excellent for computer experiments and exploring high-dimensional spaces efficiently.' },
  { id: 'halton', name: 'Halton Sequence', desc: 'Quasi-random sequence', info: 'Low-discrepancy quasi-random sequence that fills the design space more uniformly than pure random sampling. Uses prime number bases for each factor dimension.' },
  { id: 'random', name: 'Random Matrix', desc: 'Uniform random sampling', info: 'Generates random samples uniformly distributed within factor ranges. Simple and flexible, useful when no structured design is needed or for Monte Carlo studies.' },
];

/* ============================================================
   PRESET DEFINITIONS
   ============================================================ */
const PRESETS = [
  {
    name: '2-Factor Full Factorial',
    detail: '2 factors × 2 levels = 4 runs',
    doeType: 'full-factorial',
    factors: [
      { name: 'Temperature', type: 'numeric', min: 50, max: 100, levels: 2 },
      { name: 'Pressure', type: 'numeric', min: 1, max: 5, levels: 2 },
    ],
    config: {}
  },
  {
    name: '3-Factor Box-Behnken',
    detail: '3 factors, 3 levels, 15 runs',
    doeType: 'box-behnken',
    factors: [
      { name: 'Speed', type: 'numeric', min: 100, max: 500, levels: 3 },
      { name: 'Feed Rate', type: 'numeric', min: 0.1, max: 0.5, levels: 3 },
      { name: 'Depth', type: 'numeric', min: 0.5, max: 2.5, levels: 3 },
    ],
    config: { centerPoints: 3 }
  },
  {
    name: 'CCD Face-Centered',
    detail: '3 factors, 20 runs',
    doeType: 'central-composite',
    factors: [
      { name: 'pH', type: 'numeric', min: 4, max: 9, levels: 3 },
      { name: 'Conc.', type: 'numeric', min: 10, max: 50, levels: 3 },
      { name: 'Time', type: 'numeric', min: 5, max: 60, levels: 3 },
    ],
    config: { centerPoints: 6 },
    ccdSubType: 'face-centered'
  },
  {
    name: 'Latin Hypercube (5)',
    detail: '5 factors, 20 samples',
    doeType: 'latin-hypercube',
    factors: [
      { name: 'X1', type: 'numeric', min: 0, max: 100, levels: 2 },
      { name: 'X2', type: 'numeric', min: 0, max: 100, levels: 2 },
      { name: 'X3', type: 'numeric', min: 0, max: 100, levels: 2 },
      { name: 'X4', type: 'numeric', min: 0, max: 100, levels: 2 },
      { name: 'X5', type: 'numeric', min: 0, max: 100, levels: 2 },
    ],
    config: { numSamples: 20, randomSeed: 42 }
  },
];

/* ============================================================
   SEEDED PRNG (Mulberry32)
   ============================================================ */
function mulberry32(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* ============================================================
   UTILITY FUNCTIONS
   ============================================================ */
function round(v, d = 4) {
  const f = Math.pow(10, d);
  return Math.round(v * f) / f;
}

function cartesianProduct(arrays) {
  return arrays.reduce((acc, arr) => {
    const result = [];
    for (const a of acc) {
      for (const b of arr) {
        result.push([...a, b]);
      }
    }
    return result;
  }, [[]]);
}

function getFactorLevels(factor) {
  if (factor.type === 'categorical') {
    return factor.categories || [];
  }
  const n = factor.levels || 2;
  if (n === 1) return [factor.min];
  const step = (factor.max - factor.min) / (n - 1);
  return Array.from({ length: n }, (_, i) => round(factor.min + i * step));
}

function shuffleArray(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function factorNameLetter(index) {
  if (index < 26) return String.fromCharCode(65 + index);
  return 'F' + (index + 1);
}

/* ============================================================
   DOE GENERATION ALGORITHMS
   ============================================================ */

// 1. Full Factorial
function generateFullFactorial(factors) {
  const levelArrays = factors.map(f => getFactorLevels(f));
  return { matrix: cartesianProduct(levelArrays), centerRows: new Set() };
}

// 2. Fractional Factorial (2^(k-p))
function generateFractionalFactorial(factors, config) {
  const k = factors.length;
  const fractionStr = config.fraction || '1/2';
  const [num, den] = fractionStr.split('/').map(Number);
  const p = Math.round(Math.log2(den / num));
  const baseK = k - p;

  if (baseK < 1) {
    return { matrix: [], centerRows: new Set(), error: 'Too many factors for this fraction. Reduce factors or increase fraction size.' };
  }

  // Generate base 2^(baseK) full factorial in coded levels (-1, +1)
  const baseLevels = Array(baseK).fill(null).map(() => [-1, 1]);
  const baseDesign = cartesianProduct(baseLevels);

  // Generate additional columns using generators (product of base columns)
  // Standard generators: column k uses product of specific base columns
  const generators = getGenerators(baseK, p);

  const fullDesign = baseDesign.map(row => {
    const newRow = [...row];
    for (const gen of generators) {
      let val = 1;
      for (const idx of gen) {
        val *= row[idx];
      }
      newRow.push(val);
    }
    return newRow;
  });

  // Map coded values to actual factor levels
  const matrix = fullDesign.map(row => {
    return row.map((coded, i) => {
      const f = factors[i];
      if (f.type === 'categorical') {
        const cats = f.categories || [];
        return coded === -1 ? cats[0] : cats[cats.length - 1];
      }
      return coded === -1 ? f.min : f.max;
    });
  });

  return { matrix, centerRows: new Set() };
}

function getGenerators(baseK, p) {
  // Standard interaction generators
  const generators = [];
  const baseIndices = Array.from({ length: baseK }, (_, i) => i);

  // Generate interactions of increasing order
  const interactions = [];
  for (let order = 2; order <= baseK; order++) {
    const combos = getCombinations(baseIndices, order);
    interactions.push(...combos);
  }

  // Use highest-order interactions first for better resolution
  interactions.reverse();
  for (let i = 0; i < p && i < interactions.length; i++) {
    generators.push(interactions[i]);
  }
  return generators;
}

function getCombinations(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [first, ...rest] = arr;
  const withFirst = getCombinations(rest, k - 1).map(c => [first, ...c]);
  const withoutFirst = getCombinations(rest, k);
  return [...withFirst, ...withoutFirst];
}

// 3. Plackett-Burman
function generatePlackettBurman(factors) {
  const k = factors.length;
  // Find smallest N that is a multiple of 4 and >= k+1
  let N = Math.ceil((k + 1) / 4) * 4;

  // Standard PB first rows for various N
  const pbFirstRows = {
    4:  [1, 1, -1],
    8:  [1, 1, 1, -1, 1, -1, -1],
    12: [1, 1, -1, 1, 1, 1, -1, -1, -1, 1, -1],
    16: [1, 1, 1, 1, -1, 1, -1, 1, 1, -1, -1, 1, -1, -1, -1],
    20: [1, 1, -1, 1, 1, 1, 1, -1, -1, 1, -1, 1, -1, -1, 1, 1, -1, -1, -1],
    24: [1, 1, 1, 1, 1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, -1, 1, -1, 1, -1, -1, -1, -1],
  };

  const firstRow = pbFirstRows[N];
  if (!firstRow) {
    return { matrix: [], centerRows: new Set(), error: `Plackett-Burman not available for N=${N}. Supported: 4, 8, 12, 16, 20, 24 runs.` };
  }

  // Build design by cyclic shifting
  const design = [];
  const cols = firstRow.length;
  for (let i = 0; i < N - 1; i++) {
    const row = [];
    for (let j = 0; j < cols; j++) {
      row.push(firstRow[(j + i) % cols]);
    }
    design.push(row);
  }
  // Add row of all -1
  design.push(Array(cols).fill(-1));

  // Map to actual factor levels (use first k columns)
  const matrix = design.map(row => {
    return factors.map((f, i) => {
      const coded = i < row.length ? row[i] : -1;
      if (f.type === 'categorical') {
        const cats = f.categories || [];
        return coded === -1 ? cats[0] : cats[cats.length - 1];
      }
      return coded === -1 ? f.min : f.max;
    });
  });

  return { matrix, centerRows: new Set() };
}

// 4. Box-Behnken
function generateBoxBehnken(factors, config) {
  const k = factors.length;
  if (k < 3 || k > 7) {
    return { matrix: [], centerRows: new Set(), error: 'Box-Behnken requires 3 to 7 factors.' };
  }

  // Box-Behnken block definitions (pairs of factors varied at a time)
  const bbBlocks = {
    3: [[0,1],[0,2],[1,2]],
    4: [[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]],
    5: [[0,1],[0,2],[0,3],[0,4],[1,2],[1,3],[1,4],[2,3],[2,4],[3,4]],
    6: [[0,1,2],[0,3,4],[1,3,5],[2,4,5],[0,1,5],[2,3,4],[0,2,3],[1,4,5]],
    7: [[0,1,2],[0,3,4],[0,5,6],[1,3,5],[1,4,6],[2,3,6],[2,4,5]],
  };

  const blocks = bbBlocks[k];
  const centerPoints = config.centerPoints || 1;
  const centerRows = new Set();
  const coded = [];

  for (const block of blocks) {
    if (block.length === 2) {
      // Vary these 2 factors at -1, +1; others at 0
      const pairs = [[-1,-1],[-1,1],[1,-1],[1,1]];
      for (const [v1, v2] of pairs) {
        const row = Array(k).fill(0);
        row[block[0]] = v1;
        row[block[1]] = v2;
        coded.push(row);
      }
    } else {
      // For k=6,7: vary 3 factors at a time (2^3 = 8 runs per block, but use half-fraction)
      const combos = cartesianProduct(Array(block.length).fill([-1, 1]));
      // Use half-fraction: keep rows where product of all elements is +1
      const halfFraction = combos.filter(c => c.reduce((a,b) => a*b, 1) === 1);
      for (const combo of halfFraction) {
        const row = Array(k).fill(0);
        block.forEach((fi, ci) => { row[fi] = combo[ci]; });
        coded.push(row);
      }
    }
  }

  // Add center points
  for (let i = 0; i < centerPoints; i++) {
    centerRows.add(coded.length);
    coded.push(Array(k).fill(0));
  }

  // Map coded to actual values
  const matrix = coded.map(row => {
    return row.map((c, i) => {
      const f = factors[i];
      if (f.type === 'categorical') {
        const cats = f.categories || [];
        if (c === 0) return cats[Math.floor(cats.length / 2)] || cats[0];
        return c === -1 ? cats[0] : cats[cats.length - 1];
      }
      const mid = (f.min + f.max) / 2;
      const half = (f.max - f.min) / 2;
      return round(mid + c * half);
    });
  });

  return { matrix, centerRows };
}

// 5. Central Composite Design
function generateCCD(factors, config, subType) {
  const k = factors.length;
  const centerPoints = config.centerPoints || 1;

  // Factorial portion: 2^k (or 2^(k-1) for k >= 6)
  const useFraction = k >= 6;
  const fk = useFraction ? k - 1 : k;
  const factLevels = Array(fk).fill(null).map(() => [-1, 1]);
  let factDesign = cartesianProduct(factLevels);

  if (useFraction) {
    // Add generated column
    factDesign = factDesign.map(row => {
      const genVal = row.reduce((a, b) => a * b, 1);
      return [...row, genVal];
    });
  }

  // Axial points
  let alpha;
  if (subType === 'circumscribed') {
    alpha = Math.pow(factDesign.length, 0.25);
  } else if (subType === 'face-centered') {
    alpha = 1;
  } else { // inscribed
    alpha = Math.pow(factDesign.length, 0.25);
  }

  const axialPoints = [];
  for (let i = 0; i < k; i++) {
    const rowPlus = Array(k).fill(0);
    const rowMinus = Array(k).fill(0);
    rowPlus[i] = alpha;
    rowMinus[i] = -alpha;
    axialPoints.push(rowPlus, rowMinus);
  }

  const coded = [...factDesign, ...axialPoints];
  const centerRows = new Set();

  // Center points
  for (let i = 0; i < centerPoints; i++) {
    centerRows.add(coded.length);
    coded.push(Array(k).fill(0));
  }

  // For inscribed: scale so that axial points are at ±1 and factorial at ±(1/alpha)
  const scaleFactor = subType === 'inscribed' ? 1 / alpha : 1;

  // Map to actual values
  const matrix = coded.map(row => {
    return row.map((c, i) => {
      const f = factors[i];
      const mid = (f.min + f.max) / 2;
      const half = (f.max - f.min) / 2;
      let scaled = c;
      if (subType === 'inscribed') {
        // Scale factorial points inward
        if (Math.abs(c) > 0 && Math.abs(c) <= 1) {
          scaled = c * scaleFactor;
        } else if (Math.abs(c) > 1) {
          // Axial points at ±1 (boundaries)
          scaled = c > 0 ? 1 : -1;
        }
      }
      return round(mid + scaled * half);
    });
  });

  return { matrix, centerRows };
}

// 6. Latin Hypercube
function generateLatinHypercube(factors, config) {
  const n = config.numSamples || 20;
  const rng = mulberry32(config.randomSeed || 42);
  const k = factors.length;
  const matrix = [];

  // Create permutations for each factor
  const permutations = [];
  for (let j = 0; j < k; j++) {
    const perm = Array.from({ length: n }, (_, i) => i);
    permutations.push(shuffleArray(perm, rng));
  }

  for (let i = 0; i < n; i++) {
    const row = factors.map((f, j) => {
      const bin = permutations[j][i];
      const u = (bin + rng()) / n;
      if (f.type === 'categorical') {
        const cats = f.categories || [];
        return cats[Math.floor(u * cats.length)] || cats[0];
      }
      return round(f.min + u * (f.max - f.min));
    });
    matrix.push(row);
  }

  return { matrix, centerRows: new Set() };
}

// 7. Halton Sequence
function generateHalton(factors, config) {
  const n = config.numSamples || 20;
  const primes = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47];
  const matrix = [];

  function vanDerCorput(index, base) {
    let result = 0;
    let f = 1 / base;
    let i = index;
    while (i > 0) {
      result += f * (i % base);
      i = Math.floor(i / base);
      f /= base;
    }
    return result;
  }

  for (let i = 1; i <= n; i++) {
    const row = factors.map((f, j) => {
      const base = primes[j % primes.length];
      const u = vanDerCorput(i, base);
      if (f.type === 'categorical') {
        const cats = f.categories || [];
        return cats[Math.floor(u * cats.length)] || cats[0];
      }
      return round(f.min + u * (f.max - f.min));
    });
    matrix.push(row);
  }

  return { matrix, centerRows: new Set() };
}

// 8. Random Design Matrix
function generateRandom(factors, config) {
  const n = config.numSamples || 20;
  const rng = mulberry32(config.randomSeed || 42);
  const matrix = [];

  for (let i = 0; i < n; i++) {
    const row = factors.map(f => {
      if (f.type === 'categorical') {
        const cats = f.categories || [];
        return cats[Math.floor(rng() * cats.length)] || cats[0];
      }
      return round(f.min + rng() * (f.max - f.min));
    });
    matrix.push(row);
  }

  return { matrix, centerRows: new Set() };
}

/* ============================================================
   MASTER GENERATE FUNCTION
   ============================================================ */
function clearResults() {
  state.matrix = [];
  state.centerPointRows = new Set();
  state._factorNames = null;
  document.getElementById('summaryCard').style.display = 'none';
  document.getElementById('tableToolbar').style.display = 'none';
  document.getElementById('tableContainer').style.display = 'none';
  document.getElementById('pagination').style.display = 'none';
  document.getElementById('emptyState').style.display = '';
}

function generateDesign() {
  const factors = state.factors.filter(f => {
    if (f.type === 'categorical') return (f.categories || []).length >= 2;
    return f.min !== undefined && f.max !== undefined && f.min < f.max;
  });

  if (factors.length < 1) {
    clearResults();
    showToast('Please add at least one valid factor.', 'error');
    return;
  }

  let result;
  switch (state.doeType) {
    case 'full-factorial':
      result = generateFullFactorial(factors);
      break;
    case 'fractional-factorial':
      if (factors.length < 3) {
        clearResults();
        showToast('Fractional factorial requires at least 3 factors.', 'error');
        return;
      }
      result = generateFractionalFactorial(factors, state.config);
      break;
    case 'plackett-burman':
      if (factors.length < 2) {
        clearResults();
        showToast('Plackett-Burman requires at least 2 factors.', 'error');
        return;
      }
      result = generatePlackettBurman(factors);
      break;
    case 'box-behnken':
      result = generateBoxBehnken(factors, state.config);
      break;
    case 'central-composite':
      result = generateCCD(factors, state.config, state.ccdSubType);
      break;
    case 'latin-hypercube':
      result = generateLatinHypercube(factors, state.config);
      break;
    case 'halton':
      result = generateHalton(factors, state.config);
      break;
    case 'random':
      result = generateRandom(factors, state.config);
      break;
    default:
      clearResults();
      showToast('Unknown DOE type.', 'error');
      return;
  }

  if (result.error) {
    clearResults();
    showToast(result.error, 'error');
    return;
  }

  // Apply replicates
  let matrix = result.matrix;
  let centerRows = result.centerRows;
  const reps = state.config.replicates || 1;
  if (reps > 1) {
    const originalLen = matrix.length;
    const expanded = [];
    const newCenter = new Set();
    for (let r = 0; r < reps; r++) {
      for (let i = 0; i < originalLen; i++) {
        if (centerRows.has(i)) newCenter.add(expanded.length);
        expanded.push([...matrix[i]]);
      }
    }
    matrix = expanded;
    centerRows = newCenter;
  }

  // Apply randomization
  if (state.config.randomize) {
    const rng = mulberry32(state.config.randomSeed || Date.now());
    const indices = Array.from({ length: matrix.length }, (_, i) => i);
    const shuffled = shuffleArray(indices, rng);
    const newMatrix = shuffled.map(i => matrix[i]);
    const newCenter = new Set();
    shuffled.forEach((origIdx, newIdx) => {
      if (centerRows.has(origIdx)) newCenter.add(newIdx);
    });
    matrix = newMatrix;
    centerRows = newCenter;
  }

  state.matrix = matrix;
  state.centerPointRows = centerRows;
  state.currentPage = 1;
  state.sortCol = -1;
  state.searchQuery = '';

  renderResults(factors);
  showToast(`Design generated: ${matrix.length} runs`, 'success');
}

/* ============================================================
   RENDER FUNCTIONS
   ============================================================ */

/* ============================================================
   HASH ROUTING
   ============================================================ */
function selectDOEType(typeId, updateHash) {
  if (!DOE_TYPES.find(t => t.id === typeId)) return;
  state.doeType = typeId;
  if (updateHash) {
    history.replaceState(null, '', '#' + typeId);
  }
  renderDOETypes();
  renderDOEInfo();
  renderConfigPanel();
  updateWarnings();
  generateDesign();
}

function applyHashRoute() {
  const hash = location.hash.replace('#', '');
  if (hash && DOE_TYPES.find(t => t.id === hash)) {
    selectDOEType(hash, false);
  }
}

// DOE Type Grid
function renderDOETypes() {
  const grid = document.getElementById('doeTypeGrid');
  grid.innerHTML = DOE_TYPES.map(t => `
    <button class="doe-type-btn ${state.doeType === t.id ? 'active' : ''}" data-type="${t.id}">
      <span class="doe-type-name">${t.name}</span>
      <span class="doe-type-desc">${t.desc}</span>
    </button>
  `).join('');

  grid.querySelectorAll('.doe-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectDOEType(btn.dataset.type, true);
    });
  });

  renderDOEInfo();
}

function renderDOEInfo() {
  const info = DOE_TYPES.find(t => t.id === state.doeType);
  document.getElementById('doeInfo').textContent = info ? info.info : '';
}

// Factor List
function renderFactors() {
  const list = document.getElementById('factorList');
  list.innerHTML = '';

  state.factors.forEach((factor, idx) => {
    const row = document.createElement('div');
    row.className = 'factor-row fade-in';

    const isNumeric = factor.type !== 'categorical';

    row.innerHTML = `
      <div class="factor-header">
        <input type="text" class="factor-name-input" value="${factor.name}" data-idx="${idx}" placeholder="Factor name">
        <div class="factor-actions">
          <button class="btn btn-secondary btn-icon btn-sm" title="Duplicate" data-action="dup" data-idx="${idx}">⧉</button>
          <button class="btn btn-danger btn-icon btn-sm" title="Remove" data-action="del" data-idx="${idx}">✕</button>
        </div>
      </div>
      <div class="factor-type-toggle">
        <button class="${isNumeric ? 'active' : ''}" data-ftype="numeric" data-idx="${idx}">Numeric</button>
        <button class="${!isNumeric ? 'active' : ''}" data-ftype="categorical" data-idx="${idx}">Categorical</button>
      </div>
      ${isNumeric ? `
        <div class="factor-fields">
          <div class="field-group">
            <label>Min</label>
            <input type="number" value="${factor.min ?? ''}" data-field="min" data-idx="${idx}" step="any">
          </div>
          <div class="field-group">
            <label>Max</label>
            <input type="number" value="${factor.max ?? ''}" data-field="max" data-idx="${idx}" step="any">
          </div>
          <div class="field-group">
            <label>Levels</label>
            <input type="number" value="${factor.levels || 2}" data-field="levels" data-idx="${idx}" min="2" max="20">
          </div>
        </div>
      ` : `
        <div class="factor-fields categorical">
          <div class="field-group">
            <label>Categories (comma-separated)</label>
            <input type="text" value="${(factor.categories || []).join(', ')}" data-field="categories" data-idx="${idx}" placeholder="e.g. Low, Medium, High">
          </div>
        </div>
      `}
    `;

    list.appendChild(row);
  });

  // Event delegation
  list.querySelectorAll('.factor-name-input').forEach(inp => {
    inp.addEventListener('change', e => {
      state.factors[+e.target.dataset.idx].name = e.target.value;
    });
  });

  list.querySelectorAll('[data-action="dup"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = +btn.dataset.idx;
      const clone = JSON.parse(JSON.stringify(state.factors[idx]));
      clone.name = clone.name + ' (copy)';
      state.factors.splice(idx + 1, 0, clone);
      renderFactors();
      updateWarnings();
    });
  });

  list.querySelectorAll('[data-action="del"]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (state.factors.length <= 1) {
        showToast('At least one factor is required.', 'error');
        return;
      }
      state.factors.splice(+btn.dataset.idx, 1);
      renderFactors();
      updateWarnings();
    });
  });

  list.querySelectorAll('.factor-type-toggle button').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = +btn.dataset.idx;
      const newType = btn.dataset.ftype;
      state.factors[idx].type = newType;
      if (newType === 'categorical' && !state.factors[idx].categories) {
        state.factors[idx].categories = ['Low', 'High'];
      }
      renderFactors();
    });
  });

  list.querySelectorAll('[data-field]').forEach(inp => {
    inp.addEventListener('change', e => {
      const idx = +e.target.dataset.idx;
      const field = e.target.dataset.field;
      if (field === 'categories') {
        state.factors[idx].categories = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
        state.factors[idx].levels = state.factors[idx].categories.length;
      } else {
        const val = parseFloat(e.target.value);
        if (!isNaN(val)) state.factors[idx][field] = val;
        if (field === 'levels') state.factors[idx].levels = Math.max(2, Math.min(20, Math.round(val)));
      }
      updateWarnings();
    });
  });

  updateWarnings();
}

// Config Panel
function renderConfigPanel() {
  const panel = document.getElementById('configPanel');
  const t = state.doeType;
  let html = '';

  // CCD sub-type selector
  if (t === 'central-composite') {
    html += `
      <div class="field-group full-width" style="margin-bottom:0.75rem;">
        <label>CCD Type</label>
        <div class="ccd-sub-selector">
          <button class="ccd-sub-btn ${state.ccdSubType === 'circumscribed' ? 'active' : ''}" data-ccd="circumscribed">Circumscribed</button>
          <button class="ccd-sub-btn ${state.ccdSubType === 'inscribed' ? 'active' : ''}" data-ccd="inscribed">Inscribed</button>
          <button class="ccd-sub-btn ${state.ccdSubType === 'face-centered' ? 'active' : ''}" data-ccd="face-centered">Face-Centered</button>
        </div>
      </div>
    `;
  }

  html += '<div class="config-grid">';

  // Design-specific options
  if (t === 'fractional-factorial') {
    html += `
      <div class="field-group">
        <label>Resolution</label>
        <select id="cfgResolution">
          <option value="III" ${state.config.resolution === 'III' ? 'selected' : ''}>III</option>
          <option value="IV" ${state.config.resolution === 'IV' ? 'selected' : ''}>IV</option>
          <option value="V" ${state.config.resolution === 'V' ? 'selected' : ''}>V</option>
        </select>
      </div>
      <div class="field-group">
        <label>Fraction</label>
        <select id="cfgFraction">
          <option value="1/2" ${state.config.fraction === '1/2' ? 'selected' : ''}>1/2</option>
          <option value="1/4" ${state.config.fraction === '1/4' ? 'selected' : ''}>1/4</option>
          <option value="1/8" ${state.config.fraction === '1/8' ? 'selected' : ''}>1/8</option>
        </select>
      </div>
    `;
  }

  if (['box-behnken', 'central-composite'].includes(t)) {
    html += `
      <div class="field-group">
        <label>Center Points</label>
        <input type="number" id="cfgCenterPoints" value="${state.config.centerPoints}" min="0" max="20">
      </div>
    `;
  }

  if (['latin-hypercube', 'halton', 'random'].includes(t)) {
    html += `
      <div class="field-group">
        <label>Number of Samples</label>
        <input type="number" id="cfgNumSamples" value="${state.config.numSamples}" min="1" max="10000">
      </div>
    `;
  }

  if (['latin-hypercube', 'random'].includes(t)) {
    html += `
      <div class="field-group">
        <label>Random Seed</label>
        <input type="number" id="cfgSeed" value="${state.config.randomSeed}" min="0">
      </div>
    `;
  }

  // Common options
  html += `
    <div class="field-group">
      <label>Replicates</label>
      <input type="number" id="cfgReplicates" value="${state.config.replicates}" min="1" max="20">
    </div>
  `;

  html += '</div>'; // end config-grid

  // Toggles
  html += `
    <div class="toggle-row" style="margin-top:0.5rem; border-top: 1px solid var(--border); padding-top: 0.65rem;">
      <label>Randomize run order</label>
      <label class="toggle-switch">
        <input type="checkbox" id="cfgRandomize" ${state.config.randomize ? 'checked' : ''}>
        <span class="toggle-slider"></span>
      </label>
    </div>
  `;

  if (state.config.randomize) {
    html += `
      <div class="field-group" style="margin-top:0.5rem;">
        <label>Randomization Seed</label>
        <input type="number" id="cfgRandomizeSeed" value="${state.config.randomSeed}" min="0">
      </div>
    `;
  }

  panel.innerHTML = html;

  // Bind events
  const bind = (id, field, parser) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', e => {
      state.config[field] = parser ? parser(e.target.value) : e.target.value;
      if (field === 'randomize') {
        state.config.randomize = e.target.checked;
        renderConfigPanel();
      }
    });
  };

  bind('cfgResolution', 'resolution');
  bind('cfgFraction', 'fraction');
  bind('cfgCenterPoints', 'centerPoints', v => Math.max(0, parseInt(v) || 0));
  bind('cfgNumSamples', 'numSamples', v => Math.max(1, parseInt(v) || 20));
  bind('cfgSeed', 'randomSeed', v => parseInt(v) || 0);
  bind('cfgReplicates', 'replicates', v => Math.max(1, parseInt(v) || 1));
  bind('cfgRandomize', 'randomize');
  bind('cfgRandomizeSeed', 'randomSeed', v => parseInt(v) || 0);

  // CCD sub-type buttons
  panel.querySelectorAll('.ccd-sub-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.ccdSubType = btn.dataset.ccd;
      renderConfigPanel();
    });
  });
}

// Results
function renderResults(factors) {
  const matrix = state.matrix;
  if (!matrix || matrix.length === 0) {
    document.getElementById('summaryCard').style.display = 'none';
    document.getElementById('tableToolbar').style.display = 'none';
    document.getElementById('tableContainer').style.display = 'none';
    document.getElementById('pagination').style.display = 'none';
    document.getElementById('emptyState').style.display = '';
    return;
  }

  // Use factors from state for names
  const factorNames = (factors || state.factors).map(f => f.name);

  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('summaryCard').style.display = '';
  document.getElementById('tableToolbar').style.display = '';
  document.getElementById('tableContainer').style.display = '';

  // Summary
  const doeLabel = DOE_TYPES.find(t => t.id === state.doeType)?.name || state.doeType;
  const typeSizeClass = doeLabel.length > 12 ? ' text-sm' : '';
  document.getElementById('summaryGrid').innerHTML = `
    <div class="summary-item"><div class="summary-value${typeSizeClass}">${doeLabel}</div><div class="summary-label">Design Type</div></div>
    <div class="summary-item"><div class="summary-value">${factorNames.length}</div><div class="summary-label">Factors</div></div>
    <div class="summary-item"><div class="summary-value">${matrix.length}</div><div class="summary-label">Total Runs</div></div>
    <div class="summary-item"><div class="summary-value">${state.config.randomize ? 'Yes' : 'No'}</div><div class="summary-label">Randomized</div></div>
  `;

  // Build filtered & sorted view
  renderTable(factorNames);
}

function renderTable(factorNames) {
  const matrix = state.matrix;
  let indices = Array.from({ length: matrix.length }, (_, i) => i);

  // Search filter
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    indices = indices.filter(i => {
      const row = matrix[i];
      return row.some(v => String(v).toLowerCase().includes(q)) || String(i + 1).includes(q);
    });
  }

  // Sort
  if (state.sortCol >= 0) {
    indices.sort((a, b) => {
      const va = state.sortCol === 0 ? a : matrix[a][state.sortCol - 1];
      const vb = state.sortCol === 0 ? b : matrix[b][state.sortCol - 1];
      const na = typeof va === 'number' ? va : parseFloat(va);
      const nb = typeof vb === 'number' ? vb : parseFloat(vb);
      if (!isNaN(na) && !isNaN(nb)) {
        return state.sortAsc ? na - nb : nb - na;
      }
      return state.sortAsc ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
    });
  }

  // Pagination
  const totalRows = indices.length;
  const totalPages = Math.ceil(totalRows / state.rowsPerPage);
  if (state.currentPage > totalPages) state.currentPage = totalPages || 1;
  const startIdx = (state.currentPage - 1) * state.rowsPerPage;
  const pageIndices = indices.slice(startIdx, startIdx + state.rowsPerPage);

  // Header
  const head = document.getElementById('resultsHead');
  head.innerHTML = `<tr>
    <th data-col="0" class="${state.sortCol === 0 ? 'sorted' : ''}">Run # <span class="sort-icon">${state.sortCol === 0 ? (state.sortAsc ? '▲' : '▼') : '⇅'}</span></th>
    ${factorNames.map((n, i) => `
      <th data-col="${i + 1}" class="${state.sortCol === i + 1 ? 'sorted' : ''}">${n} <span class="sort-icon">${state.sortCol === i + 1 ? (state.sortAsc ? '▲' : '▼') : '⇅'}</span></th>
    `).join('')}
  </tr>`;

  // Body
  const body = document.getElementById('resultsBody');
  body.innerHTML = pageIndices.map(i => {
    const isCenter = state.centerPointRows.has(i);
    return `<tr class="${isCenter ? 'center-point' : ''}">
      <td>${i + 1}</td>
      ${matrix[i].map(v => `<td>${v}</td>`).join('')}
    </tr>`;
  }).join('');

  // Sort click handlers
  head.querySelectorAll('th').forEach(th => {
    th.addEventListener('click', () => {
      const col = +th.dataset.col;
      if (state.sortCol === col) {
        state.sortAsc = !state.sortAsc;
      } else {
        state.sortCol = col;
        state.sortAsc = true;
      }
      renderTable(factorNames);
    });
  });

  // Pagination
  const pagEl = document.getElementById('pagination');
  if (totalPages > 1) {
    pagEl.style.display = 'flex';
    let pagHtml = `<button ${state.currentPage <= 1 ? 'disabled' : ''} data-page="${state.currentPage - 1}">‹</button>`;
    for (let p = 1; p <= totalPages; p++) {
      if (totalPages <= 7 || p <= 2 || p >= totalPages - 1 || Math.abs(p - state.currentPage) <= 1) {
        pagHtml += `<button class="${p === state.currentPage ? 'active' : ''}" data-page="${p}">${p}</button>`;
      } else if (p === 3 && state.currentPage > 4) {
        pagHtml += `<span class="pagination-info">…</span>`;
      } else if (p === totalPages - 2 && state.currentPage < totalPages - 3) {
        pagHtml += `<span class="pagination-info">…</span>`;
      }
    }
    pagHtml += `<button ${state.currentPage >= totalPages ? 'disabled' : ''} data-page="${state.currentPage + 1}">›</button>`;
    pagEl.innerHTML = pagHtml;

    pagEl.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        state.currentPage = +btn.dataset.page;
        renderTable(factorNames);
      });
    });
  } else {
    pagEl.style.display = 'none';
  }

  // Store factor names for export
  state._factorNames = factorNames;
}

// Warnings
function updateWarnings() {
  const banner = document.getElementById('factorWarning');
  const text = document.getElementById('factorWarningText');
  const k = state.factors.length;
  const t = state.doeType;
  let msg = '';

  if (t === 'box-behnken' && (k < 3 || k > 7)) {
    msg = 'Box-Behnken design requires 3 to 7 factors.';
  } else if (t === 'fractional-factorial' && k < 3) {
    msg = 'Fractional factorial requires at least 3 factors.';
  } else if (t === 'plackett-burman' && k < 2) {
    msg = 'Plackett-Burman requires at least 2 factors.';
  }

  // Check min < max
  state.factors.forEach(f => {
    if (f.type !== 'categorical' && f.min !== undefined && f.max !== undefined && f.min >= f.max) {
      msg = msg || `Factor "${f.name}": Min must be less than Max.`;
    }
  });

  if (msg) {
    text.textContent = msg;
    banner.classList.add('visible');
  } else {
    banner.classList.remove('visible');
  }
}

// Presets
function renderPresets() {
  const grid = document.getElementById('presetGrid');
  grid.innerHTML = PRESETS.map((p, i) => `
    <button class="preset-btn" data-preset="${i}">
      <span class="preset-name">${p.name}</span>
      <span class="preset-detail">${p.detail}</span>
    </button>
  `).join('');

  grid.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      loadPreset(+btn.dataset.preset);
    });
  });
}

function loadPreset(idx) {
  const p = PRESETS[idx];
  state.doeType = p.doeType;
  state.factors = JSON.parse(JSON.stringify(p.factors));
  if (p.ccdSubType) state.ccdSubType = p.ccdSubType;
  Object.assign(state.config, p.config);
  history.replaceState(null, '', '#' + p.doeType);
  renderDOETypes();
  renderFactors();
  renderConfigPanel();
  generateDesign();
  showToast(`Loaded: ${p.name}`, 'info');
}

/* ============================================================
   EXPORT FUNCTIONS
   ============================================================ */
function exportCSV() {
  if (!state.matrix.length) return;
  const names = state._factorNames || state.factors.map(f => f.name);
  let csv = 'Run,' + names.join(',') + '\n';
  state.matrix.forEach((row, i) => {
    csv += (i + 1) + ',' + row.map(v => typeof v === 'string' && v.includes(',') ? `"${v}"` : v).join(',') + '\n';
  });
  downloadFile(csv, 'novadoe_design.csv', 'text/csv');
  showToast('CSV downloaded', 'success');
}

function exportJSON() {
  if (!state.matrix.length) return;
  const names = state._factorNames || state.factors.map(f => f.name);
  const data = state.matrix.map((row, i) => {
    const obj = { run: i + 1 };
    row.forEach((v, j) => { obj[names[j]] = v; });
    return obj;
  });
  const json = JSON.stringify({ doeType: state.doeType, factors: names, runs: data }, null, 2);
  downloadFile(json, 'novadoe_design.json', 'application/json');
  showToast('JSON downloaded', 'success');
}

function copyToClipboard() {
  if (!state.matrix.length) return;
  const names = state._factorNames || state.factors.map(f => f.name);
  let text = 'Run\t' + names.join('\t') + '\n';
  state.matrix.forEach((row, i) => {
    text += (i + 1) + '\t' + row.join('\t') + '\n';
  });
  navigator.clipboard.writeText(text).then(() => {
    showToast('Copied to clipboard', 'success');
  }).catch(() => {
    showToast('Copy failed — try manually', 'error');
  });
}

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ============================================================
   TOAST
   ============================================================ */
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = { success: '✓', error: '✗', info: 'ℹ' };
  toast.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ'}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

/* ============================================================
   THEME
   ============================================================ */
function initTheme() {
  const saved = localStorage.getItem('novadoe-theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);
  updateThemeIcon();
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('novadoe-theme', next);
  updateThemeIcon();
}

function updateThemeIcon() {
  const btn = document.getElementById('themeToggle');
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  btn.textContent = isDark ? '☀️' : '🌙';
}

/* ============================================================
   SAVE / LOAD
   ============================================================ */
function saveSetup() {
  const data = {
    doeType: state.doeType,
    ccdSubType: state.ccdSubType,
    factors: state.factors,
    config: state.config,
  };
  localStorage.setItem('novadoe-setup', JSON.stringify(data));
  showToast('Setup saved to browser', 'success');
}

function loadSetup() {
  const raw = localStorage.getItem('novadoe-setup');
  if (!raw) {
    showToast('No saved setup found', 'error');
    return;
  }
  try {
    const data = JSON.parse(raw);
    state.doeType = data.doeType || 'full-factorial';
    state.ccdSubType = data.ccdSubType || 'face-centered';
    state.factors = data.factors || [];
    Object.assign(state.config, data.config || {});
    renderDOETypes();
    renderFactors();
    renderConfigPanel();
    showToast('Setup loaded', 'success');
  } catch {
    showToast('Failed to load setup', 'error');
  }
}

/* ============================================================
   ADD FACTOR
   ============================================================ */
function addFactor() {
  const idx = state.factors.length;
  state.factors.push({
    name: 'Factor ' + factorNameLetter(idx),
    type: 'numeric',
    min: 0,
    max: 100,
    levels: 2,
  });
  renderFactors();
}

/* ============================================================
   INITIALIZATION
   ============================================================ */
function init() {
  initTheme();

  // Default factors
  state.factors = [
    { name: 'Temperature', type: 'numeric', min: 50, max: 100, levels: 2 },
    { name: 'Pressure', type: 'numeric', min: 1, max: 5, levels: 2 },
  ];

  renderDOETypes();
  renderFactors();
  renderConfigPanel();
  renderPresets();

  // Apply hash route (e.g., #box-behnken)
  applyHashRoute();
  window.addEventListener('hashchange', () => applyHashRoute());

  // Event bindings
  document.getElementById('themeToggle').addEventListener('click', toggleTheme);
  document.getElementById('btnAddFactor').addEventListener('click', addFactor);
  document.getElementById('btnGenerate').addEventListener('click', generateDesign);
  document.getElementById('btnReset').addEventListener('click', () => {
    if (confirm('Reset all inputs and results?')) {
      state.factors = [
        { name: 'Factor A', type: 'numeric', min: 0, max: 100, levels: 2 },
        { name: 'Factor B', type: 'numeric', min: 0, max: 100, levels: 2 },
      ];
      state.doeType = 'full-factorial';
      state.config = { resolution: 'III', fraction: '1/2', numSamples: 20, centerPoints: 1, randomSeed: 42, replicates: 1, randomize: false };
      state.matrix = [];
      state.centerPointRows = new Set();
      renderDOETypes();
      renderFactors();
      renderConfigPanel();
      renderResults([]);
      showToast('All inputs reset', 'info');
    }
  });

  document.getElementById('btnSaveSetup').addEventListener('click', saveSetup);
  document.getElementById('btnLoadSetup').addEventListener('click', loadSetup);
  document.getElementById('btnExportCSV').addEventListener('click', exportCSV);
  document.getElementById('btnExportJSON').addEventListener('click', exportJSON);
  document.getElementById('btnCopy').addEventListener('click', copyToClipboard);
  document.getElementById('btnPrint').addEventListener('click', () => window.print());

  document.getElementById('tableSearch').addEventListener('input', e => {
    state.searchQuery = e.target.value;
    state.currentPage = 1;
    if (state._factorNames) renderTable(state._factorNames);
  });

  // Auto-generate default on load
  generateDesign();
}

document.addEventListener('DOMContentLoaded', init);
