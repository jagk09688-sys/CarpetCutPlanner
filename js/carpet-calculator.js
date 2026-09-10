// Carpet calculation helpers

function getRoomAreaM2(room, ppm) {
  if (!room) return 0;

  if (typeof room.areaM2 === 'number' && room.areaM2 > 0) return room.areaM2;

  if (room.isPolygon && Array.isArray(room.points) && room.points.length >= 3) {
    let areaPx2 = 0;
    for (let i = 0; i < room.points.length; i++) {
      const j = (i + 1) % room.points.length;
      const p1 = room.points[i];
      const p2 = room.points[j];
      areaPx2 += p1.x * p2.y - p2.x * p1.y;
    }
    const areaPx = Math.abs(areaPx2) / 2;
    const ppmVal = typeof ppm === 'number' && ppm > 0 ? ppm : 1;
    return areaPx / (ppmVal * ppmVal);
  }

  const L = room.length, W = room.width;
  if (L && W) return L * W;
  return 0;
}

function roundUp(val, step) {
  if (!step || step <= 0) return val;
  return Math.ceil(val / step) * step;
}

function fmt(n)    { return n.toFixed(2); }
function fmtGBP(n) { return '\u00a3' + n.toFixed(2); }

// ─── Orientation helper ────────────────────────────────────────────────────────
function getRoomOrientInfo(room, rollWidth) {
  const L = room.length, W = room.width;
  const dropsAlongLength = Math.ceil(W / rollWidth); // run along L, across W
  const dropsAlongWidth  = Math.ceil(L / rollWidth); // run along W, across L

  let runSide, acrossSide, totalDrops, orientLabel;

  if (!room.orientation || room.orientation === 'auto') {
    const lenA = dropsAlongLength * L;
    const lenB = dropsAlongWidth  * W;
    if (dropsAlongLength < dropsAlongWidth ||
        (dropsAlongLength === dropsAlongWidth && lenA <= lenB)) {
      runSide = L; acrossSide = W; totalDrops = dropsAlongLength; orientLabel = 'along length';
    } else {
      runSide = W; acrossSide = L; totalDrops = dropsAlongWidth;  orientLabel = 'along width';
    }
  } else if (room.orientation === 'length') {
    runSide = L; acrossSide = W; totalDrops = dropsAlongLength; orientLabel = 'along length';
  } else {
    runSide = W; acrossSide = L; totalDrops = dropsAlongWidth;  orientLabel = 'along width';
  }

  return { runSide, acrossSide, totalDrops, orientLabel };
}

// ─── Optimisation finder ───────────────────────────────────────────────────────
// Detects when extending a room's cut length allows later narrow rooms to be
// cut from the offcut instead of buying new carpet.
// Supports multiple beneficiaries per donor: the offcut width may cascade to
// cover several rooms in index order (first room takes its slice, surplus goes
// to the next, etc.).
// Returns: { donorIndex: { extendTo, beneficiaryIndex, beneficiaryName, allBeneficiaries, savingM } }
function findOptimisations(metreRooms, rollWidth, roundTo) {
  const opts = {};

  for (let i = 0; i < metreRooms.length; i++) {
    const roomA = metreRooms[i];
    if (!roomA.length || !roomA.width) continue;

    const { runSide: runA, acrossSide: acrossA, totalDrops: dropsA } = getRoomOrientInfo(roomA, rollWidth);
    const offcutW = dropsA * rollWidth - acrossA;
    if (offcutW <= 0.05) continue;

    const currentA = roundUp(runA, roundTo);

    // Gather all later rooms whose acrossSide fits in the offcut cascade.
    // For 'auto' rooms, also try swapping run↔across if that fits better.
    // benefitM = what the room would cost if bought fresh (natural orientation),
    // used for the saving calculation so alt-orientation doesn't inflate the estimate.
    const candidates = [];
    for (let j = i + 1; j < metreRooms.length; j++) {
      const roomB = metreRooms[j];
      if (!roomB.length || !roomB.width) continue;
      const { runSide: runB, acrossSide: acrossB, totalDrops: dropsB } = getRoomOrientInfo(roomB, rollWidth);
      const naturalBenefitM = roundUp(dropsB * runB, roundTo); // fresh cost (natural orientation)
      if (acrossB <= offcutW + 0.001) {
        candidates.push({ j, runB, acrossB, dropsB, name: roomB.name, benefitM: naturalBenefitM });
      } else if ((!roomB.orientation || roomB.orientation === 'auto') && runB <= offcutW + 0.001) {
        // Alt orientation: swap run and across — no extra joints if altDrops <= dropsB
        const altAcrossB = runB;
        const altRunB    = acrossB;
        const altDropsB  = Math.ceil(altAcrossB / rollWidth);
        if (altDropsB <= dropsB) {
          // benefitM is still the NATURAL cost — that's what we save if this room uses the offcut
          candidates.push({ j, runB: altRunB, acrossB: altAcrossB, dropsB: altDropsB, name: roomB.name, benefitM: naturalBenefitM });
        }
      }
    }

    if (candidates.length === 0) continue;

    // Try each distinct extendTo value; for each, pack rooms in index order
    // (mirrors actual computation order so cascade matches real behaviour)
    const extLengths = [...new Set(candidates.map(c => roundUp(c.runB, roundTo)))]
      .filter(ext => ext > currentA)
      .sort((a, b) => a - b);

    let bestSaving = 0.01;
    let bestConfig = null;

    for (const extendTo of extLengths) {
      const extraA = roundUp(dropsA * extendTo, roundTo) - roundUp(dropsA * currentA, roundTo);

      // Pack rooms in index order; each takes its slice, remainder cascades
      let remainingW = offcutW;
      const packed = [];
      for (const c of candidates) {
        if (roundUp(c.runB, roundTo) <= extendTo && c.acrossB <= remainingW + 0.001) {
          packed.push(c);
          remainingW -= c.acrossB;
        }
      }

      if (packed.length === 0) continue;

      const totalBenefit = packed.reduce((sum, c) => sum + c.benefitM, 0);
      const savingM = totalBenefit - extraA;

      if (savingM > bestSaving) {
        bestSaving = savingM;
        bestConfig = {
          extendTo,
          beneficiaryIndex: packed[0].j,
          beneficiaryName: packed.map(c => c.name).join(' + '),
          allBeneficiaries: packed.map(c => c.j),
          savingM,
        };
      }
    }

    if (bestConfig) opts[i] = bestConfig;
  }

  return opts;
}

function cloneOffcuts(offcuts) {
  return offcuts.map(o => ({ from: o.from, width: o.width, length: o.length }));
}

function simulateRoomPlan(rooms, rollWidth, roundTo, wastePerDrop) {
  const offcuts = [];
  const results = [];
  let totalLen = 0;
  let totalRollArea = 0;
  let totalOffcutArea = 0;
  let totalJoints = 0;
  let totalCarpetArea = 0;

  rooms.forEach(room => {
    const res = calcRoom(room, rollWidth, roundTo, offcuts, 0, wastePerDrop);
    results.push(res);
    if (!res) return;
    totalLen += res.roomLen;
    totalRollArea += res.rollAreaUsed || 0;
    totalOffcutArea += res.offcutUsedArea || 0;
    totalJoints += res.joints;
    totalCarpetArea += res.carpetArea;
  });

  return { results, totalLen, totalRollArea, totalOffcutArea, totalJoints, totalCarpetArea, offcuts };
}

function chooseBestOrientationSequence(rooms, rollWidth, roundTo, wastePerDrop) {
  const chosenRooms = rooms.map(room => ({ ...room }));
  const offcuts = [];

  chosenRooms.forEach(room => {
    if (!room.orientation || room.orientation === 'auto') {
      const candidates = ['length', 'width'].map(orientation => {
        const simRoom = { ...room, orientation };
        const simOffcuts = cloneOffcuts(offcuts);
        const res = calcRoom(simRoom, rollWidth, roundTo, simOffcuts, 0, wastePerDrop);
        return res ? { orientation, res } : null;
      }).filter(Boolean);

      if (candidates.length > 0) {
        candidates.sort((a, b) => {
          if (a.res.rollAreaUsed !== b.res.rollAreaUsed) return a.res.rollAreaUsed - b.res.rollAreaUsed;
          if (a.res.offcutUsedArea !== b.res.offcutUsedArea) return b.res.offcutUsedArea - a.res.offcutUsedArea;
          if (a.res.joints !== b.res.joints) return a.res.joints - b.res.joints;
          return a.res.roomLen - b.res.roomLen;
        });
        room.orientation = candidates[0].orientation;
      }
    }

    calcRoom(room, rollWidth, roundTo, offcuts, 0, wastePerDrop);
  });

  return chosenRooms;
}

function chooseBestRoomPlan(metreRooms, rollWidth, roundTo, wastePerDrop) {
  const baseRooms = metreRooms.map((room, idx) => ({ ...room, origIdx: idx }));

  const orderings = [
    {
      key: 'potentialOffcut',
      sortFn: (a, b) => {
        const ia = getRoomOrientInfo(a, rollWidth);
        const ib = getRoomOrientInfo(b, rollWidth);
        const offcutA = (ia.totalDrops * rollWidth - ia.acrossSide) * ia.runSide;
        const offcutB = (ib.totalDrops * rollWidth - ib.acrossSide) * ib.runSide;
        return offcutB - offcutA;
      }
    },
    {
      key: 'roomArea',
      sortFn: (a, b) => (b.length * b.width) - (a.length * a.width)
    },
    {
      key: 'narrowAcross',
      sortFn: (a, b) => {
        const ia = getRoomOrientInfo(a, rollWidth);
        const ib = getRoomOrientInfo(b, rollWidth);
        return ia.acrossSide - ib.acrossSide;
      }
    },
    {
      key: 'longRun',
      sortFn: (a, b) => {
        const ia = getRoomOrientInfo(a, rollWidth);
        const ib = getRoomOrientInfo(b, rollWidth);
        return ib.runSide - ia.runSide;
      }
    },
    {
      key: 'input',
      sortFn: (a, b) => a.origIdx - b.origIdx
    }
  ];

  const candidates = orderings.map(order => {
    const orderedRooms = baseRooms.slice().sort(order.sortFn).map(room => ({ ...room }));
    const orientedRooms = chooseBestOrientationSequence(orderedRooms, rollWidth, roundTo, wastePerDrop);
    const sim = simulateRoomPlan(orientedRooms, rollWidth, roundTo, wastePerDrop);
    return { key: order.key, orderedRooms: orientedRooms, sim };
  });

  candidates.sort((a, b) => {
    if (a.sim.totalLen !== b.sim.totalLen) return a.sim.totalLen - b.sim.totalLen;
    if (a.sim.totalRollArea !== b.sim.totalRollArea) return a.sim.totalRollArea - b.sim.totalRollArea;
    return a.sim.totalJoints - b.sim.totalJoints;
  });

  return candidates[0] || { orderedRooms: baseRooms, sim: simulateRoomPlan(baseRooms, rollWidth, roundTo, wastePerDrop), key: 'fallback' };
}

// ─── Cross-cut / split-join helper ───────────────────────────────────────────
// Instead of buying a full-length drop for the narrow last strip, buy shorter
// pieces (= narrowStripWidth metres off the roll) and rotate them 90° to
// assemble the strip lengthwise.  One extra seam per additional piece.
// Returns { numPieces, crossCutLen, saved, extraJoins } or null if no saving.
function calcCrossCut(narrowStrip, runSide, rollWidth, roundTo) {
  if (narrowStrip <= 0.001) return null;
  const numPieces    = Math.ceil(runSide / rollWidth);
  const crossCutLen  = numPieces * roundUp(narrowStrip, roundTo);
  const standardLen  = roundUp(runSide, roundTo);
  const saved        = parseFloat((standardLen - crossCutLen).toFixed(3));
  if (saved <= 0.01) return null;
  return { numPieces, crossCutLen, saved, extraJoins: numPieces - 1 };
}

function tryBuildFromOffcuts(offcuts, requiredWidth, requiredLength) {
  if (requiredWidth <= 0.001 || requiredLength <= 0.001) return null;

  const candidates = offcuts
    .map((strip, index) => ({ strip, index }))
    .filter(item => item.strip.width >= requiredWidth && item.strip.length > 0)
    .sort((a, b) => {
      if (b.strip.length !== a.strip.length) return b.strip.length - a.strip.length;
      return a.strip.width - b.strip.width;
    });

  let remaining = requiredLength;
  const selected = [];
  for (const item of candidates) {
    if (remaining <= 0) break;
    selected.push(item);
    remaining -= item.strip.length;
  }
  if (remaining > 0) return null;

  const leftovers = [];
  let remainingLen = requiredLength;

  selected
    .map(item => item.index)
    .sort((a, b) => b - a)
    .forEach(idx => offcuts.splice(idx, 1));

  for (const { strip } of selected) {
    const useLen = Math.min(strip.length, remainingLen);
    remainingLen -= useLen;

    if (strip.width - requiredWidth > 0.05) {
      leftovers.push({ from: strip.from, width: strip.width - requiredWidth, length: strip.length });
    }
    if (strip.length - useLen > 0.05) {
      leftovers.push({ from: strip.from, width: requiredWidth, length: strip.length - useLen });
    }
  }

  leftovers.forEach(piece => offcuts.push(piece));

  return {
    pieceCount: selected.length,
    usedFrom: selected.map(item => item.strip.from),
  };
}

// ─── Core room calculator ─────────────────────────────────────────────────────
// minRunLength: optionally extend the run side (used by optimisation)
// wastePerDrop: extra metres added per fresh-roll drop for trimming allowance
function calcRoom(room, rollWidth, roundTo, offcuts, minRunLength = 0, wastePerDrop = 0) {
  const L = room.length, W = room.width;
  if (!L || !W) return null;

  const { runSide: naturalRun, acrossSide, orientLabel } = getRoomOrientInfo(room, rollWidth);
  const roomAreaM2 = getRoomAreaM2(room);

  // Apply extension if optimisation requested
  const runSide = (minRunLength > naturalRun) ? roundUp(minRunLength, roundTo) : naturalRun;
  const wasExtended = runSide > naturalRun;
  const effectiveRunSide = roomAreaM2 > 0 && acrossSide > 0.001 ? Math.min(runSide, roomAreaM2 / acrossSide) : runSide;

  const fullDrops   = Math.floor(acrossSide / rollWidth);
  const leftoverGap = acrossSide - fullDrops * rollWidth; // width of narrow last strip

  // Alternative orientation: swap run↔across for 'auto' rooms when it helps offcut reuse.
  // Only viable when: orientation is auto (user hasn't locked it), room is non-square,
  // no donor extension is in play (minRunLength===0), and swapping doesn't add joints.
  const altAcross = naturalRun;   // old run becomes new across
  const altRun    = acrossSide;   // old across becomes new run
  const altViable = (!room.orientation || room.orientation === 'auto')
    && Math.abs(altAcross - acrossSide) > 0.001            // non-square
    && minRunLength === 0                                   // not a pre-planned extension
    && Math.ceil(altAcross / rollWidth) <= Math.ceil(acrossSide / rollWidth); // no more joints
  const altFullDrops   = altViable ? Math.floor(altAcross / rollWidth) : 0;
  const altLeftoverGap = altViable ? altAcross - altFullDrops * rollWidth : 0;
  const altOrientLabel = orientLabel === 'along length' ? 'along width' : 'along length';
  const altEffectiveRunSide = altViable && altAcross > 0.001 && roomAreaM2 > 0
    ? Math.min(altRun, roomAreaM2 / altAcross)
    : altRun;

  // --- Best-fit offcut search (tries both natural and alt orientation) ---
  // Prefers natural orientation; falls back to alt only when it fits and natural doesn't.
  // Among equal-orientation candidates picks snuggest fit (smallest surplus width).
  let bestFull = -1, bestFullSlack = Infinity, bestFullAlt = false;
  let bestPart = -1, bestPartSlack = Infinity, bestPartAlt = false;

  for (let i = 0; i < offcuts.length; i++) {
    const s = offcuts[i];

    // Natural: full room
    if (s.length >= runSide && s.width >= acrossSide) {
      const slack = s.width - acrossSide;
      if (slack < bestFullSlack) { bestFull = i; bestFullSlack = slack; bestFullAlt = false; }
    }
    // Natural: last narrow drop
    if (leftoverGap > 0.001 && s.length >= runSide && s.width >= leftoverGap) {
      const slack = s.width - leftoverGap;
      if (slack < bestPartSlack) { bestPart = i; bestPartSlack = slack; bestPartAlt = false; }
    }

    if (altViable) {
      // Alt: full room (only beats natural if strictly snugger)
      if (s.length >= altRun && s.width >= altAcross) {
        const slack = s.width - altAcross;
        if (slack < bestFullSlack) { bestFull = i; bestFullSlack = slack; bestFullAlt = true; }
      }
      // Alt: last narrow drop
      if (altLeftoverGap > 0.001 && s.length >= altRun && s.width >= altLeftoverGap) {
        const slack = s.width - altLeftoverGap;
        if (slack < bestPartSlack) { bestPart = i; bestPartSlack = slack; bestPartAlt = true; }
      }
    }
  }

  // Apply full-room coverage (always preferred over partial)
  if (bestFull >= 0) {
    const effAcross = bestFullAlt ? altAcross : acrossSide;
    const effRun    = bestFullAlt ? altRun    : runSide;
    const effLabel  = bestFullAlt ? altOrientLabel : orientLabel;
    const strip = offcuts[bestFull];
    const surplusW = strip.width - effAcross;
    offcuts.splice(bestFull, 1);
    if (surplusW > 0.05) offcuts.push({ from: strip.from, width: surplusW, length: strip.length });
    const surplus  = surplusW > 0.05 ? `, ${fmt(surplusW)}m surplus re-stored` : '';
    const altNote  = bestFullAlt ? ' ↻ orientation swapped to use offcut' : '';
    const fullArea = effAcross * effRun;
    return {
      roomLen: 0, joints: 0, drops: 1,
      carpetArea: fullArea,
      offcutUsed: `Entire room from offcut [${strip.from}]${surplus}${altNote}`,
      offcutUsedArea: fullArea,
      rollAreaUsed: 0,
      offcutGenerated: null,
      orientLabel: effLabel, extended: false, naturalRoomLen: 0
    };
  }

  // Apply partial coverage (last narrow drop from offcut)
  if (bestPart >= 0) {
    const effFull    = bestPartAlt ? altFullDrops   : fullDrops;
    const effGap     = bestPartAlt ? altLeftoverGap : leftoverGap;
    const effRunSide = bestPartAlt ? altEffectiveRunSide : effectiveRunSide;
    const effLabel   = bestPartAlt ? altOrientLabel : orientLabel;
    const strip = offcuts[bestPart];
    const surplusW = strip.width - effGap;
    offcuts.splice(bestPart, 1);
    if (surplusW > 0.05) offcuts.push({ from: strip.from, width: surplusW, length: strip.length });
    const roomLen    = roundUp(effFull * (effRunSide + wastePerDrop), roundTo);
    const carpetArea = effFull * rollWidth * effRunSide + effGap * effRunSide;
    const offcutArea = effGap * effRunSide;
    const surplus    = surplusW > 0.05 ? `, ${fmt(surplusW)}m surplus re-stored` : '';
    const altNote    = bestPartAlt ? ' ↻ orientation swapped to use offcut' : '';
    const rollAreaUsed = parseFloat((carpetArea - offcutArea).toFixed(3));
    return {
      roomLen, joints: effFull, drops: effFull + 1,
      carpetArea,
      offcutUsed: `Last narrow strip only (${fmt(effGap)}m) from offcut [${strip.from}]${surplus}${altNote}`,
      offcutUsedArea: offcutArea,
      rollAreaUsed,
      offcutGenerated: null,
      orientLabel: effLabel, extended: false, naturalRoomLen: 0, areaBasedPackingUsed: false
    };
  }

  // Use multiple offcuts end-to-end for a narrow one-drop room when split/join is enabled.
  if (room.splitJoin && fullDrops === 0 && acrossSide <= rollWidth) {
    const combo = tryBuildFromOffcuts(offcuts, acrossSide, runSide);
    if (combo && combo.pieceCount > 1) {
      const fullArea = runSide * acrossSide;
      return {
        roomLen: 0,
        joints: combo.pieceCount - 1,
        drops: 1,
        carpetArea: fullArea,
        offcutUsed: `Full room from combined offcuts [${combo.usedFrom.join(', ')}]`,
        offcutUsedArea: fullArea,
        rollAreaUsed: 0,
        offcutGenerated: null,
        orientLabel,
        extended: false,
        naturalRoomLen: 0,
        areaBasedPackingUsed: false
      };
    }
  }

  const totalDrops     = Math.ceil(acrossSide / rollWidth);
  // fullDrops and leftoverGap already computed above
  const joints         = totalDrops - 1;
  const leftoverW      = totalDrops * rollWidth - acrossSide;  // offcut width from last drop
  const naturalRoomLen = roundUp(totalDrops * (effectiveRunSide + wastePerDrop), roundTo);

  // For polygon rooms we can compute total run-length required from area
  // (sum of all drops lengths = area / rollWidth). If that total is smaller
  // than the naive rectangular-length estimate, prefer it — this lets the
  // leftover strip(s) produced by the same room be reused internally rather
  // than forcing an extra full-length purchase.
  if (room.isPolygon && roomAreaM2 > 0) {
    const requiredTotalRun = roomAreaM2 / rollWidth; // metres of roll required in total
    const roundedRequired  = roundUp(requiredTotalRun + wastePerDrop, roundTo);
    if (roundedRequired < naturalRoomLen - 1e-9) {
      const roomLen = roundedRequired;
      const carpetArea = parseFloat((roomLen * rollWidth).toFixed(3));
      // No offcut generated beyond what remains across the drops: compute
      // remaining width per final drop as before and produce an offcut if large.
      let offcutGenerated = null;
      if (leftoverW > 0.05) {
        offcutGenerated = { from: room.name, width: leftoverW, length: effectiveRunSide };
        offcuts.push(offcutGenerated);
      }

      return {
        roomLen, joints, drops: totalDrops, carpetArea,
        offcutUsed: null, offcutUsedArea: 0, rollAreaUsed: carpetArea,
        offcutGenerated, orientLabel, extended: wasExtended, naturalRoomLen,
        narrowStripW: leftoverGap, runSideUsed: effectiveRunSide, splitJoin: null,
        areaBasedPackingUsed: true,
      };
    }
  }

  // ── Cross-cut / split-join ─────────────────────────────────────────────────
  // For the one-full-drop + narrow-last-strip case, share the same run length
  // with the narrow remainder instead of treating it as a second full drop.
  const shouldUseSharedRun = fullDrops === 1 && leftoverGap > 0.001 && leftoverGap < rollWidth * 0.5;
  if (shouldUseSharedRun) {
    const sharedRunLen = roundUp(runSide + wastePerDrop, roundTo);
    const carpetArea   = sharedRunLen * rollWidth;

    let offcutGenerated = null;
    if (leftoverW > 0.05) {
      offcutGenerated = { from: room.name, width: leftoverW, length: runSide };
      offcuts.push(offcutGenerated);
    }

    return {
      roomLen: sharedRunLen,
      joints,
      drops: totalDrops,
      carpetArea,
      offcutUsed: null,
      offcutUsedArea: 0,
      rollAreaUsed: carpetArea,
      offcutGenerated,
      orientLabel,
      extended: wasExtended,
      naturalRoomLen,
      narrowStripW: leftoverGap,
      runSideUsed: runSide,
      splitJoin: null,
      areaBasedPackingUsed: false,
    };
  }
  // ── End cross-cut ──────────────────────────────────────────────────────────

  const canShareRunLength = leftoverGap > 0.001 && fullDrops > 0 && leftoverGap < rollWidth;
  const roomLen    = canShareRunLength
    ? roundUp((effectiveRunSide + wastePerDrop), roundTo)
    : roundUp(totalDrops * (effectiveRunSide + wastePerDrop), roundTo);
  const carpetArea = roomLen * rollWidth;

  let offcutGenerated = null;
  if (leftoverW > 0.05) {
    offcutGenerated = { from: room.name, width: leftoverW, length: runSide };
    offcuts.push(offcutGenerated);
  }

  const narrowStripW = leftoverGap > 0.001 ? leftoverGap : 0;

  const rollAreaUsed = parseFloat((carpetArea - 0).toFixed(3));
  return {
    roomLen, joints, drops: totalDrops, carpetArea,
    offcutUsed: null, offcutUsedArea: 0, rollAreaUsed, offcutGenerated, orientLabel,
    extended: wasExtended, naturalRoomLen,
    narrowStripW, runSideUsed: runSide,
    splitJoin: null,
    areaBasedPackingUsed: false,
  };
}

// ─── Cut layout diagram (SVG) ─────────────────────────────────────────────────
function generateCutDiagramSVG(metreRoom, res, rollWidth, idx) {
  const { runSide, acrossSide, totalDrops } = getRoomOrientInfo(metreRoom, rollWidth);

  const MAX_W = 220, MAX_H = 130;
  const sc = Math.min(MAX_W / runSide, MAX_H / acrossSide);
  const rW = +(runSide * sc).toFixed(1);
  const rH = +(acrossSide * sc).toFixed(1);
  const SVG_H = rH + 22;

  const fills = ['#dbeafe', '#bfdbfe'];
  let body = '';

  for (let d = 0; d < totalDrops; d++) {
    const y1 = +(d * rollWidth * sc).toFixed(1);
    const y2 = d < totalDrops - 1 ? +((d + 1) * rollWidth * sc).toFixed(1) : rH;
    const h  = +(y2 - y1).toFixed(1);
    body += `<rect x="0" y="${y1}" width="${rW}" height="${h}" fill="${fills[d % 2]}"/>`;
    if (d > 0) {
      body += `<line x1="0" y1="${y1}" x2="${rW}" y2="${y1}" stroke="#dc2626" stroke-width="1.5" stroke-dasharray="4,3"/>`;
    }
    const midY = +((y1 + y2) / 2).toFixed(1);
    const lastW = acrossSide % rollWidth || rollWidth;
    const wLabel = d < totalDrops - 1 ? fmt(rollWidth) : fmt(lastW);
    body += `<text x="${(rW / 2).toFixed(1)}" y="${midY}" dy="0.35em" text-anchor="middle" font-size="7" fill="#1e40af" font-family="Arial">D${d + 1}: ${wLabel}m</text>`;
  }

  const uid = `ra${idx}`;
  const arrY = (rH / 2).toFixed(1);

  body += `
    <rect x="0" y="0" width="${rW}" height="${rH}" fill="none" stroke="#1e3a5f" stroke-width="1.5"/>
    <defs><marker id="${uid}" markerWidth="6" markerHeight="5" refX="5" refY="2.5" orient="auto">
      <path d="M0,0 L0,5 L6,2.5 z" fill="#1d4ed8"/>
    </marker></defs>
    <line x1="10" y1="${arrY}" x2="${(rW - 10).toFixed(1)}" y2="${arrY}" stroke="#1d4ed8" stroke-width="1.2" marker-end="url(#${uid})" opacity="0.55"/>
    <text x="${(rW / 2).toFixed(1)}" y="${(rH + 14).toFixed(1)}" text-anchor="middle" font-size="7.5" fill="#374151" font-family="Arial">${runSide.toFixed(2)}m run × ${acrossSide.toFixed(2)}m across</text>`;

  return `<svg width="${rW}" height="${SVG_H}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

// ─── Main calculate() ─────────────────────────────────────────────────────────

function calculate() {
  if (rooms.length === 0) {
    alert('Please draw some rooms first!');
    return;
  }

  const ppm          = getPxPerMeter();
  const rollWidth    = parseFloat(document.getElementById('rollWidth').value)    || 4;
  const roundTo      = parseFloat(document.getElementById('roundTo').value)      || 0.1;
  const wastePerCut  = parseFloat(document.getElementById('wastePerCut').value)  || 0;
  const pricePerSqm  = parseFloat(document.getElementById('pricePerSqm').value)  || 0;
  const fittingCost  = parseFloat(document.getElementById('fittingCost').value)  || 0;
  const pricePerLinM = pricePerSqm * rollWidth;
  const excludedRooms = rooms.filter(room => ['wet', 'window'].includes(room.roomType));

  // Clear any previous offcut link annotations so the canvas starts fresh
  rooms.forEach(r => { r.offcutInfo = null; r.isOffcutDonor = null; });

  // Build metre rooms array first so we can run optimisation pre-scan
  const metreRooms = rooms.filter(room => !['wet', 'window'].includes(room.roomType)).map(room => ({
    name:        room.name,
    length:      room._ocrLength || room.width  / ppm,
    width:       room._ocrWidth  || room.height / ppm,
    areaM2:      getRoomAreaM2(room, ppm),
    orientation: room.orientation || 'auto',
    splitJoin:   !!room.splitJoin,
  }));

  // Debug log for OCR-imported rooms
  rooms.filter(room => !['wet', 'window'].includes(room.roomType)).forEach((room, idx) => {
    if (room._ocrLength || room._ocrWidth) {
      const mr = metreRooms[idx];
      console.log(`[CALC ROOM ${idx} "${room.name}"] Using OCR: length=${mr.length.toFixed(2)}m width=${mr.width.toFixed(2)}m`);
    }
  });

  // Try several installer-like room orders and choose the one that uses the least roll.
  const plan = chooseBestRoomPlan(metreRooms, rollWidth, roundTo, wastePerCut);
  let orderedRooms = plan.orderedRooms;

  // Run optimisation pre-scan in the chosen room order so donor→beneficiary pairs align
  const orderedOpts  = findOptimisations(orderedRooms, rollWidth, roundTo);

  // Capture floor plan from canvas for the print report
  const canvasEl = document.getElementById('canvas');
  const floorPlanDataUrl = canvasEl.toDataURL('image/png');

  const offcuts     = [];
  const calcResults = new Array(metreRooms.length); // indexed by original position
  orderedRooms.forEach((room, orderPos) => {
    const opt    = orderedOpts[orderPos];
    const minRun = opt ? opt.extendTo : 0;
    calcResults[room.origIdx] = calcRoom(room, rollWidth, roundTo, offcuts, minRun, wastePerCut);
  });

  let totalLen      = 0;
  let totalJoints   = 0;
  let totalRoomArea = 0;
  let totalSavingM  = 0;
  let html          = '';
  const tableData   = [];

  metreRooms.forEach((metreRoom, idx) => {
    const res    = calcResults[idx];
    const orderPos = orderedRooms.findIndex(r => r.origIdx === idx);
    const opt    = orderPos >= 0 ? orderedOpts[orderPos] : null;

    if (!res) {
      html += `<div class="room-card"><h3>${metreRoom.name}</h3><p style="color:#999">Room has no dimensions.</p></div>`;
      return;
    }

    totalLen      += res.roomLen;
    totalJoints   += res.joints;

    const roomArea   = metreRoom.length * metreRoom.width;
    totalRoomArea   += roomArea;
    const carpetArea = res.carpetArea;
    const wasteArea  = Math.max(0, carpetArea - roomArea);
    const roomCost   = res.roomLen * pricePerLinM;

    const jointsClass = res.joints === 0 ? 'joints-0' : res.joints === 1 ? 'joints-1' : 'joints-2p';
    const jointsLabel = res.joints === 0 ? '0 \u2014 seamless' : res.joints;

    tableData.push({ metreRoom, res, roomArea, carpetArea, wasteArea, roomCost, jointsLabel });

    // Optimisation note for donor room
    let optNote = '';
    if (opt && res.extended) {
      const savingCost = opt.savingM * pricePerLinM;
      totalSavingM += opt.savingM;
      const extraLen = res.roomLen - res.naturalRoomLen;
      optNote = `<div class="info-strip info-green">
        &#9889; <strong>Optimised:</strong> cut extended by ${fmt(extraLen)}m
        (${fmt(res.naturalRoomLen)}m &rarr; ${fmt(res.roomLen)}m) so
        <strong>${opt.beneficiaryName}</strong> can be cut from the offcut
        ${pricePerSqm > 0 ? `&mdash; saves ${fmtGBP(savingCost)}` : `&mdash; saves ${fmt(opt.savingM)}m of roll`}
      </div>`;
    }

    // ── Cross-cut option ──────────────────────────────────────────────────────
    // When the last drop is a narrow strip, the customer can rotate a short
    // piece of roll 90° (cross-grain) instead of buying a full-length drop.
    // This saves carpet but the pile direction will differ — offer as option only.
    let crossCutNote = '';
    if (res.narrowStripW > 0.05 && !res.offcutUsed && !res.splitJoin) {
      const strip      = res.narrowStripW;           // narrow strip width (m)
      const runS       = res.runSideUsed;            // carpet run length (m)
      const numPieces  = Math.ceil(runS / rollWidth); // pieces needed end-to-end
      const crossCutLen = numPieces * roundUp(strip, roundTo); // total roll metres
      const standardLen = roundUp(runS, roundTo);    // metres for a normal full drop
      const saving      = standardLen - crossCutLen;

      if (saving > 0.05) {
        const savingCost    = saving * pricePerLinM;
        const extraJoins    = numPieces - 1; // extra butt-joins within the strip
        const joinsWarning  = extraJoins > 0
          ? ` (needs ${extraJoins} extra butt-join${extraJoins > 1 ? 's' : ''} within the strip)`
          : '';

        crossCutNote = `<div class="info-strip info-teal">
          &#9986; <strong>Customer option &mdash; cross-cut last strip:</strong>
          The ${fmt(strip)}m strip only needs ${fmt(strip)}m of roll width.
          Buy just ${numPieces > 1 ? numPieces + '&times;' : ''}${fmt(roundUp(strip, roundTo))}m
          of roll and rotate it 90&deg; &mdash; saves
          ${pricePerSqm > 0 ? fmtGBP(savingCost) : fmt(saving) + 'm of roll'}${joinsWarning}.
          <br><em>&#9888; Pile direction will differ at this seam &mdash; confirm with customer before cutting.</em>
        </div>`;
      }
    }
    const diagramSvg = generateCutDiagramSVG(metreRoom, res, rollWidth, idx);
    const packingNote = res.areaBasedPackingUsed ? `<div class="info-strip info-amber">&#8635; <strong>Area-based packing used:</strong> this polygon room reused leftover strips internally before adding more roll length.</div>` : '';

    html += `
      <div class="room-card">
        <h3>${metreRoom.name} &mdash; ${fmt(metreRoom.length)} &times; ${fmt(metreRoom.width)} m</h3>
        <div class="room-card-body">
          <div class="room-card-stats">
            <div class="stats">
              <div class="stat ${jointsClass}">
                <div class="lbl">Joints / Seams</div>
                <div class="val">${jointsLabel}</div>
              </div>
              <div class="stat">
                <div class="lbl">Drops</div>
                <div class="val">${res.drops}</div>
              </div>
              <div class="stat">
                <div class="lbl">Direction</div>
                <div class="val">${res.orientLabel}</div>
              </div>
              <div class="stat">
                <div class="lbl">Roll Length Used</div>
                <div class="val">${res.offcutUsed ? 'from offcut' : fmt(res.roomLen) + ' m'}</div>
              </div>
              <div class="stat">
                <div class="lbl">Floor Area</div>
                <div class="val">${fmt(roomArea)} m&sup2;</div>
              </div>
              <div class="stat">
                <div class="lbl">Carpet Cut Area</div>
                <div class="val">${fmt(carpetArea)} m&sup2;</div>
              </div>
              <div class="stat">
                <div class="lbl">Roll Area Used</div>
                <div class="val">${fmt(res.rollAreaUsed || 0)} m&sup2;</div>
              </div>
              ${res.offcutUsedArea > 0 ? `
              <div class="stat">
                <div class="lbl">Offcut Used</div>
                <div class="val">${fmt(res.offcutUsedArea)} m&sup2;</div>
              </div>
              ` : ''}
              <div class="stat">
                <div class="lbl">Offcut Waste</div>
                <div class="val">${fmt(wasteArea)} m&sup2;</div>
              </div>
              ${pricePerSqm > 0 ? `
              <div class="stat">
                <div class="lbl">Room Carpet Cost</div>
                <div class="val">${res.offcutUsed ? '(offcut)' : fmtGBP(roomCost)}</div>
              </div>` : ''}
            </div>
            ${optNote}
            ${packingNote}
            ${res.offcutUsed      ? `<div class="info-strip info-green">&#10003; Offcut reused: ${res.offcutUsed}</div>` : ''}
            ${res.offcutGenerated ? `<div class="info-strip info-amber">&#10003; Offcut stored (${fmt(res.offcutGenerated.width)}&times;${fmt(res.offcutGenerated.length)} m) &mdash; available for later rooms</div>` : ''}
            ${crossCutNote}
            ${res.splitJoin ? `
              <div class="info-strip info-purple">
                &#9986; <strong>Cross-cut applied &mdash; customer saving option ON:</strong>
                The ${fmt(res.narrowStripW)}m last strip is cut from
                ${res.splitJoin.numPieces > 1 ? res.splitJoin.numPieces + '&times;' : ''}${fmt(roundUp(res.narrowStripW, roundTo))}m
                pieces rotated 90&deg; instead of one full-length drop &mdash;
                saves <strong>${fmt(res.splitJoin.saved)}m of roll${pricePerSqm > 0 ? ` (${fmtGBP(res.splitJoin.saved * pricePerLinM)})` : ''}</strong>.
                ${res.splitJoin.extraJoins > 0 ? `<br>${res.splitJoin.extraJoins} extra butt-join${res.splitJoin.extraJoins > 1 ? 's' : ''} within the strip.` : ''}
                <br><em>&#9888; Pile direction will differ at this seam &mdash; confirm with customer. Best for plain or loop-pile carpet.</em>
              </div>` : ''}
          </div>
          <div class="room-card-diagram print-only">
            <div class="diagram-title">Cut Layout</div>
            ${diagramSvg}
            <div class="diagram-legend">
              <span class="leg-drop"></span> D1&nbsp;
              <span class="leg-drop leg-alt"></span> D2&nbsp;
              <span class="leg-seam"></span> Seam&nbsp;
              <span class="leg-arrow">&#8594;</span> Run
            </div>
          </div>
        </div>
      </div>`;
  });

  const totalCarpetCost = totalLen * pricePerLinM;
  const grandTotal      = totalCarpetCost + fittingCost;
  const totalCarpetArea = totalLen * rollWidth;
  const totalSavingCost = totalSavingM * pricePerLinM;

  let summaryHtml = `
    <div class="summary-bar">
      <div class="sum-stat"><div class="lbl">Total Roll Length</div><div class="val">${fmt(totalLen)} m</div></div>
      <div class="sum-stat"><div class="lbl">Total Floor Area</div><div class="val">${fmt(totalRoomArea)} m&sup2;</div></div>
      <div class="sum-stat"><div class="lbl">Carpet Area Bought</div><div class="val">${fmt(totalCarpetArea)} m&sup2;</div></div>
      <div class="sum-stat"><div class="lbl">Total Joints</div><div class="val">${totalJoints}</div></div>`;

  if (pricePerSqm > 0) {
    summaryHtml += `<div class="sum-stat"><div class="lbl">Carpet Material</div><div class="val">${fmtGBP(totalCarpetCost)}</div></div>`;
    if (fittingCost > 0) {
      summaryHtml += `
        <div class="sum-stat"><div class="lbl">Fitting</div><div class="val">${fmtGBP(fittingCost)}</div></div>
        <div class="sum-stat"><div class="lbl">Total (inc. fitting)</div><div class="val">${fmtGBP(grandTotal)}</div></div>`;
    }
    summaryHtml += `<div class="sum-stat"><div class="lbl">Effective Price / m&sup2;</div><div class="val">${fmtGBP(totalRoomArea > 0 ? grandTotal / totalRoomArea : 0)}</div></div>`;
  }

  if (totalSavingM > 0) {
    const savingDisplay = pricePerSqm > 0 ? fmtGBP(totalSavingCost) : `${fmt(totalSavingM)} m`;
    summaryHtml += `<div class="sum-stat saving-stat"><div class="lbl">&#9889; Optimisation Saving</div><div class="val">${savingDisplay}</div></div>`;
  }

  summaryHtml += `</div>`;

  if (excludedRooms.length > 0) {
    summaryHtml += `<div class="info-strip info-teal"><strong>Excluded from carpet:</strong> ${excludedRooms.map(room => `${room.name} (${getRoomTypeLabel(room.roomType)})`).join(', ')}. These areas remain on the floor plan for reference.</div>`;
  }

  let offcutNote = '';
  if (offcuts.length) {
    offcutNote = `<div class="offcut-note"><strong>Stored offcuts (${offcuts.length}):</strong> ` +
      offcuts.map(o => `${o.from}: ${fmt(o.width)}&times;${fmt(o.length)} m`).join(' &nbsp;|&nbsp; ') +
      '</div>';
  }

  const jobRef    = (document.getElementById('jobRef').value || '').trim();
  const printDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  const printHeader = `
    <div class="print-only print-header">
      <div>
        <h2>Carpet Installation Plan</h2>
        ${jobRef ? `<div style="font-size:10pt;color:#555;margin-top:0.2rem">${jobRef}</div>` : ''}
      </div>
      <div class="ph-meta">
        Date: ${printDate}<br>
        Roll width: ${rollWidth} m<br>
        Waste per cut: ${fmt(wastePerCut)} m<br>
        ${pricePerSqm > 0 ? `Price: &pound;${pricePerSqm.toFixed(2)}/m&sup2;<br>` : ''}
        ${fittingCost  > 0 ? `Fitting: &pound;${fittingCost.toFixed(2)}<br>`       : ''}
        Generated by Carpet Planner
      </div>
    </div>`;

  // ── Floor plan section (print-only) ────────────────────────────────────────
  const floorPlanSection = `
    <div class="print-only print-section">
      <h3 class="print-section-title">&#9635; Floor Plan</h3>
      <div class="print-floor-plan">
        <img src="${floorPlanDataUrl}" alt="Floor Plan">
      </div>
    </div>`;

  // ── Cutting schedule table (print-only) ─────────────────────────────────────
  let scheduleRows = '';
  tableData.forEach(({ metreRoom, res, roomArea, carpetArea, wasteArea, roomCost, jointsLabel }) => {
    const rollUsed = res.offcutUsed ? 'Offcut' : `${fmt(res.roomLen)} m`;
    const costCell = pricePerSqm > 0 ? `<td>${res.offcutUsed ? '&mdash;' : fmtGBP(roomCost)}</td>` : '';
    scheduleRows += `<tr>
      <td>${metreRoom.name}</td>
      <td>${fmt(metreRoom.length)} &times; ${fmt(metreRoom.width)}</td>
      <td>${res.orientLabel}</td>
      <td>${res.drops}</td>
      <td>${jointsLabel}</td>
      <td>${rollUsed}</td>
      <td>${fmt(roomArea)} m&sup2;</td>
      <td>${fmt(carpetArea)} m&sup2;</td>
      <td>${fmt(wasteArea)} m&sup2;</td>
      ${costCell}
    </tr>`;
  });

  const totalCarpetArea2 = totalLen * rollWidth;
  const scheduleTable = `
    <div class="print-only print-section">
      <h3 class="print-section-title">&#9986; Cutting Schedule</h3>
      <table class="cutting-schedule">
        <thead>
          <tr>
            <th>Room</th><th>Size (m)</th><th>Direction</th><th>Drops</th><th>Joints</th>
            <th>Roll Used</th><th>Floor Area</th><th>Cut Area</th><th>Waste</th>
            ${pricePerSqm > 0 ? '<th>Cost</th>' : ''}
          </tr>
        </thead>
        <tbody>${scheduleRows}</tbody>
        <tfoot>
          <tr>
            <td colspan="5" class="sched-total-label">Totals</td>
            <td>${fmt(totalLen)} m</td>
            <td>${fmt(totalRoomArea)} m&sup2;</td>
            <td>${fmt(totalCarpetArea2)} m&sup2;</td>
            <td>${fmt(Math.max(0, totalCarpetArea2 - totalRoomArea))} m&sup2;</td>
            ${pricePerSqm > 0 ? `<td>${fmtGBP(totalCarpetCost)}</td>` : ''}
          </tr>
        </tfoot>
      </table>
    </div>`;

  const printBtn = `
    <div class="no-print" style="margin-top:0.75rem">
      <button class="btn-print" onclick="window.print()">&#128438; Print / Save PDF</button>
    </div>`;

  document.getElementById('results').innerHTML =
    `<div class="result">${printHeader}${floorPlanSection}${scheduleTable}${html}${summaryHtml}${offcutNote}${printBtn}</div>`;
}

function resetOffcuts() {
  document.getElementById('results').innerHTML =
    '<div class="result"><p style="color:#6b7280;padding:8px">Offcuts cleared. Click Calculate to refresh.</p></div>';
}

// ─── combineRooms (canvas feature) ────────────────────────────────────────────

function combineRooms(roomId1, roomId2) {
  const r1 = rooms.find(r => r.id === roomId1);
  const r2 = rooms.find(r => r.id === roomId2);
  if (!r1 || !r2) return;

  const originalR1 = JSON.parse(JSON.stringify(r1));
  const originalR2 = JSON.parse(JSON.stringify(r2));

  const minX = Math.min(r1.x, r2.x);
  const minY = Math.min(r1.y, r2.y);
  const maxX = Math.max(r1.x + r1.width, r2.x + r2.width);
  const maxY = Math.max(r1.y + r1.height, r2.y + r2.height);

  const combinedRoom = {
    id: Date.now(),
    name: `${r1.name} + ${r2.name}`,
    x: minX, y: minY,
    width: maxX - minX, height: maxY - minY,
    orientation: 'auto',
    color: r1.color,
    doors: [...r1.doors, ...r2.doors],
    isCombined: true,
    originalRoomData: [originalR1, originalR2]
  };

  rooms = rooms.filter(r => r.id !== roomId1 && r.id !== roomId2);
  rooms.push(combinedRoom);
  selectedRoom = combinedRoom;
  updateRoomsList();
  draw();
  calculate();
}

if (typeof module !== 'undefined') {
  module.exports = { roundUp, getRoomOrientInfo, calcRoom, calcCrossCut, findOptimisations };
}
