const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

// Resize canvas to fill container
function resizeCanvas() {
  const container = canvas.parentElement;
  canvas.width = container.clientWidth;
  canvas.height = container.clientHeight;
  draw();
}

window.addEventListener('resize', resizeCanvas);
window.addEventListener('load', () => {
  resizeCanvas();
  checkAutoSave();
});

// World/Screen coordinate conversion
function screenToWorld(screenX, screenY) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (screenX - rect.left - panX) / zoom,
    y: (screenY - rect.top - panY) / zoom
  };
}

function worldToScreen(worldX, worldY) {
  return {
    x: worldX * zoom + panX,
    y: worldY * zoom + panY
  };
}

// Touch events for mobile (single-touch → mouse events, two-finger → pinch zoom)
let _lastPinchDist = null;
let _lastPinchMidX = null;
let _lastPinchMidY = null;

canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  if (e.touches.length === 2) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    _lastPinchDist = Math.sqrt(dx * dx + dy * dy);
    _lastPinchMidX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    _lastPinchMidY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    return;
  }
  _lastPinchDist = null;
  const touch = e.touches[0];
  canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: touch.clientX, clientY: touch.clientY }));
});

canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  if (e.touches.length === 2) {
    const dx   = e.touches[0].clientX - e.touches[1].clientX;
    const dy   = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;

    if (_lastPinchDist) {
      const scale   = dist / _lastPinchDist;
      const rect    = canvas.getBoundingClientRect();
      const oldZoom = zoom;
      zoom = Math.max(0.2, Math.min(8, zoom * scale));
      // Keep the pinch midpoint fixed on the canvas
      panX = midX - rect.left - (midX - rect.left - panX) * (zoom / oldZoom);
      panY = midY - rect.top  - (midY - rect.top  - panY) * (zoom / oldZoom);
      // Pan drift from finger movement
      panX += midX - _lastPinchMidX;
      panY += midY - _lastPinchMidY;
      draw();
    }
    _lastPinchDist = dist;
    _lastPinchMidX = midX;
    _lastPinchMidY = midY;
    return;
  }
  _lastPinchDist = null;
  const touch = e.touches[0];
  canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: touch.clientX, clientY: touch.clientY }));
});

canvas.addEventListener('touchend', (e) => {
  e.preventDefault();
  _lastPinchDist = null;
  const touch = e.changedTouches[0];
  canvas.dispatchEvent(new MouseEvent('mouseup', {
    clientX: touch.clientX,
    clientY: touch.clientY
  }));
});

// Mouse events
canvas.addEventListener('mousedown', (e) => {
  const world = screenToWorld(e.clientX, e.clientY);

  if (panMode) {
    canvas.style.cursor = 'grabbing';
    lastPanX = e.clientX;
    lastPanY = e.clientY;
    dragging = true;
    return;
  }

  if (mode === 'draw') {
    drawing = true;
    startX = world.x;
    startY = world.y;
  } else if (mode === 'polygon') {
    // snap-close if near first point
    if (polygonPoints.length >= 3) {
      const fp = polygonPoints[0];
      const snapDist = 12 / zoom;
      if (Math.hypot(world.x - fp.x, world.y - fp.y) < snapDist) {
        finalisePolygon(polygonPoints.slice());
        updateInfo();
        return;
      }
    }
    polygonPoints.push({ x: world.x, y: world.y });
    draw();
    updateInfo();
  } else if (mode === 'select') {
    for (let i = rooms.length - 1; i >= 0; i--) {
      const room = rooms[i];
      const hit = room.isPolygon
        ? pointInPolygon(world.x, world.y, room.points)
        : (world.x >= room.x && world.x <= room.x + room.width &&
           world.y >= room.y && world.y <= room.y + room.height);
      if (hit) {
        dragging = true;
        dragRoom = room;
        selectedRoom = room;
        dragOffsetX = world.x - room.x;
        dragOffsetY = world.y - room.y;
        canvas.style.cursor = 'grabbing';
        updateRoomsList();
        draw();
        return;
      }
    }
    selectedRoom = null;
    updateRoomsList();
    draw();
  } else if (mode === 'door') {
    addDoorAtPosition(world.x, world.y);
  } else if (mode === 'freehand') {
    drawing = true;
    currentPath = {
      points: [{x: world.x, y: world.y}],
      color: document.getElementById('penColor').value,
      size: parseInt(document.getElementById('penSize').value)
    };
  } else if (mode === 'erase') {
    eraseFreehandAt(world.x, world.y);
  }
});

canvas.addEventListener('mousemove', (e) => {
  const world = screenToWorld(e.clientX, e.clientY);

  if (panMode && dragging) {
    panX += e.clientX - lastPanX;
    panY += e.clientY - lastPanY;
    lastPanX = e.clientX;
    lastPanY = e.clientY;
    draw();
    return;
  }

  if (drawing && mode === 'draw') {
    draw();
    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);
    ctx.strokeStyle = '#3498db';
    ctx.lineWidth = 2 / zoom;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(startX, startY, world.x - startX, world.y - startY);
    ctx.restore();
  } else if (mode === 'polygon' && polygonPoints.length > 0) {
    // Store cursor world pos for preview in draw()
    canvas._polyPreview = { x: world.x, y: world.y };
    draw();
  } else if (dragging && dragRoom) {
    const dx = (world.x - dragOffsetX) - dragRoom.x;
    const dy = (world.y - dragOffsetY) - dragRoom.y;
    dragRoom.x += dx;
    dragRoom.y += dy;
    if (dragRoom.isPolygon && dragRoom.points) {
      dragRoom.points = dragRoom.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
    }
    draw();
  } else if (drawing && mode === 'freehand' && currentPath) {
    currentPath.points.push({x: world.x, y: world.y});
    draw();
  }
});

canvas.addEventListener('mouseup', (e) => {
  if (panMode && dragging) {
    canvas.style.cursor = 'default';
    dragging = false;
    return;
  }

  if (mode === 'polygon') {
    // double-click closes the polygon
    const now = Date.now();
    if (canvas._lastPolyClick && (now - canvas._lastPolyClick) < 350 && polygonPoints.length >= 3) {
      // remove the duplicate point added by the second mousedown
      polygonPoints.pop();
      finalisePolygon(polygonPoints.slice());
      canvas._lastPolyClick = null;
      updateInfo();
      return;
    }
    canvas._lastPolyClick = now;
    return;
  }

  if (drawing && mode === 'draw') {
    const world = screenToWorld(e.clientX, e.clientY);
    
    const width = Math.abs(world.x - startX);
    const height = Math.abs(world.y - startY);
    
    if (width > 20 && height > 20) {
      const room = {
        id: Date.now(),
        name: `Room ${roomCounter++}`,
        x: Math.min(startX, world.x),
        y: Math.min(startY, world.y),
        width: width,
        height: height,
        orientation: 'auto',
        color: getRandomColor(),
        doors: []
      };
      rooms.push(room);
      selectedRoom = room;
      updateRoomsList();
      draw();
    }
    
    drawing = false;
  } else if (dragging && dragRoom) {
    canvas.style.cursor = 'move';
    dragging = false;
    dragRoom = null;
  } else if (drawing && mode === 'freehand' && currentPath) {
    // Apply line straightening
    currentPath.points = straightenPath(currentPath.points);
    freehandPaths.push(currentPath);
    currentPath = null;
    drawing = false;
    draw();
  }
});

// Main draw function
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw background image (screen space — always fills canvas, grid/rooms on top)
  if (typeof bgImage !== 'undefined' && bgImage) {
    const opacity = (document.getElementById('bgOpacity').value || 35) / 100;
    ctx.globalAlpha = opacity;
    ctx.drawImage(bgImage, 0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;
  }

  ctx.save();
  ctx.translate(panX, panY);
  ctx.scale(zoom, zoom);

  // Draw grid
  const ppm = getPxPerMeter();
  ctx.strokeStyle = '#e0e0e0';
  ctx.lineWidth = 1 / zoom;
  
  const startGridX = -panX / zoom;
  const startGridY = -panY / zoom;
  const endX = (canvas.width - panX) / zoom;
  const endY = (canvas.height - panY) / zoom;
  
  for (let x = Math.floor(startGridX / ppm) * ppm; x < endX; x += ppm) {
    ctx.beginPath();
    ctx.moveTo(x, startGridY);
    ctx.lineTo(x, endY);
    ctx.stroke();
  }
  
  for (let y = Math.floor(startGridY / ppm) * ppm; y < endY; y += ppm) {
    ctx.beginPath();
    ctx.moveTo(startGridX, y);
    ctx.lineTo(endX, y);
    ctx.stroke();
  }

  // Draw freehand paths
  freehandPaths.forEach(path => {
    if (path.points.length < 2) return;
    
    ctx.strokeStyle = path.color;
    ctx.lineWidth = path.size / zoom;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    ctx.beginPath();
    ctx.moveTo(path.points[0].x, path.points[0].y);
    for (let i = 1; i < path.points.length; i++) {
      ctx.lineTo(path.points[i].x, path.points[i].y);
    }
    ctx.stroke();
  });

  // Draw current freehand path
  if (currentPath && currentPath.points.length > 1) {
    ctx.strokeStyle = currentPath.color;
    ctx.lineWidth = currentPath.size / zoom;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    ctx.beginPath();
    ctx.moveTo(currentPath.points[0].x, currentPath.points[0].y);
    for (let i = 1; i < currentPath.points.length; i++) {
      ctx.lineTo(currentPath.points[i].x, currentPath.points[i].y);
    }
    ctx.stroke();
  }

  // Draw rooms
  rooms.forEach(room => {
    // ── Carpet orientation + strips + joints — all clipped to room ──────────
    const rollWidthVal = parseFloat(document.getElementById('rollWidth').value) || 4;
    const rollWidthPx  = rollWidthVal * ppm;
    const metreRoomForDraw = {
      length:      room.width  / ppm,
      width:       room.height / ppm,
      orientation: room.orientation || 'auto'
    };
    const orientInfo    = getRoomOrientInfo(metreRoomForDraw, rollWidthVal);
    const isAlongLength = orientInfo.orientLabel === 'along length';
    const jointColor    = '#c0392b';

    // ── Step 1: base room fill ────────────────────────────────────────────────
    ctx.fillStyle = room.color + (room === selectedRoom ? 'AA' : '66');
    if (room.isPolygon && room.points) {
      ctx.beginPath();
      ctx.moveTo(room.points[0].x, room.points[0].y);
      room.points.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillRect(room.x, room.y, room.width, room.height);
    }

    ctx.save();
    ctx.beginPath();
    if (room.isPolygon && room.points) {
      ctx.moveTo(room.points[0].x, room.points[0].y);
      room.points.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.closePath();
    } else {
      ctx.rect(room.x, room.y, room.width, room.height);
    }
    ctx.clip();

    // ── Step 2: pile grain lines (industry-standard carpet direction indicator)
    // Fine lines running the full room in the carpet direction —
    // immediately obvious regardless of where joints fall.
    const grainSpacing = Math.max(6 / zoom, rollWidthPx / 8);
    ctx.strokeStyle = room.color + (room === selectedRoom ? 'FF' : 'CC');
    ctx.lineWidth   = 0.8 / zoom;
    ctx.setLineDash([]);
    if (isAlongLength) {
      // Carpet runs left→right  →  grain lines are horizontal
      for (let gy = room.y + grainSpacing; gy < room.y + room.height; gy += grainSpacing) {
        ctx.beginPath();
        ctx.moveTo(room.x, gy);
        ctx.lineTo(room.x + room.width, gy);
        ctx.stroke();
      }
    } else {
      // Carpet runs top→bottom  →  grain lines are vertical
      for (let gx = room.x + grainSpacing; gx < room.x + room.width; gx += grainSpacing) {
        ctx.beginPath();
        ctx.moveTo(gx, room.y);
        ctx.lineTo(gx, room.y + room.height);
        ctx.stroke();
      }
    }

    // ── Step 3: alternating strip shading (shows each roll drop) ─────────────
    if (isAlongLength) {
      let sy = room.y, sn = 0;
      while (sy < room.y + room.height) {
        if (sn % 2 === 1) {
          ctx.fillStyle = 'rgba(0,0,0,0.10)';
          ctx.fillRect(room.x, sy, room.width,
                       Math.min(rollWidthPx, room.y + room.height - sy));
        }
        sy += rollWidthPx; sn++;
      }
    } else {
      let sx = room.x, sn = 0;
      while (sx < room.x + room.width) {
        if (sn % 2 === 1) {
          ctx.fillStyle = 'rgba(0,0,0,0.10)';
          ctx.fillRect(sx, room.y,
                       Math.min(rollWidthPx, room.x + room.width - sx), room.height);
        }
        sx += rollWidthPx; sn++;
      }
    }

    // ── Step 3b: Cross-cut strip visualization ───────────────────────────────
    // Applied (splitJoin ON)  → solid teal fill + perpendicular grain + piece lines
    // Suggested (splitJoin OFF but narrow strip exists) → ghost dashed outline only
    {
      const acrossSidePx = isAlongLength ? room.height : room.width;
      const fullDropsCC  = Math.floor(acrossSidePx / rollWidthPx);
      const narrowPx     = acrossSidePx - fullDropsCC * rollWidthPx;
      // Only draw when there is a genuine partial last strip (> 5 cm in metres)
      const narrowM      = narrowPx / ppm;
      if (fullDropsCC > 0 && narrowM > 0.05) {
        const applied = !!room.splitJoin;
        // Helper: draw the cross-cut strip in one orientation
        const drawCCStrip = (sx, sy, sw, sh, vertical) => {
          if (applied) {
            // Solid teal fill
            ctx.fillStyle = 'rgba(22,160,133,0.22)';
            ctx.fillRect(sx, sy, sw, sh);
          } else {
            // Ghost: very faint amber fill so it's noticeable but clearly "not applied"
            ctx.fillStyle = 'rgba(230,126,34,0.10)';
            ctx.fillRect(sx, sy, sw, sh);
          }

          // Perpendicular grain lines
          const grainCol = applied ? 'rgba(22,160,133,0.60)' : 'rgba(230,126,34,0.45)';
          ctx.strokeStyle = grainCol;
          ctx.lineWidth   = 0.8 / zoom;
          ctx.setLineDash([]);
          if (vertical) {
            // grain runs vertically (perpendicular to horizontal main strips)
            for (let gx = sx + grainSpacing; gx < sx + sw; gx += grainSpacing) {
              ctx.beginPath(); ctx.moveTo(gx, sy); ctx.lineTo(gx, sy + sh); ctx.stroke();
            }
          } else {
            // grain runs horizontally (perpendicular to vertical main strips)
            for (let gy = sy + grainSpacing; gy < sy + sh; gy += grainSpacing) {
              ctx.beginPath(); ctx.moveTo(sx, gy); ctx.lineTo(sx + sw, gy); ctx.stroke();
            }
          }

          // Piece-boundary lines within the strip
          const bdCol  = applied ? '#16a085' : '#e67e22';
          const bdWt   = applied ? 2 / zoom : 1.5 / zoom;
          const dash   = [5 / zoom, 4 / zoom];
          ctx.strokeStyle = bdCol;
          ctx.lineWidth   = bdWt;
          ctx.setLineDash(dash);
          if (vertical) {
            // boundaries are vertical lines along X
            for (let bx = sx + rollWidthPx; bx < sx + sw - 1 / zoom; bx += rollWidthPx) {
              ctx.beginPath(); ctx.moveTo(bx, sy); ctx.lineTo(bx, sy + sh); ctx.stroke();
            }
          } else {
            // boundaries are horizontal lines along Y
            for (let by = sy + rollWidthPx; by < sy + sh - 1 / zoom; by += rollWidthPx) {
              ctx.beginPath(); ctx.moveTo(sx, by); ctx.lineTo(sx + sw, by); ctx.stroke();
            }
          }
          ctx.setLineDash([]);

          // Outer border of the strip (dashed teal/amber)
          ctx.strokeStyle = applied ? '#16a085' : '#e67e22';
          ctx.lineWidth   = applied ? 1.5 / zoom : 1 / zoom;
          ctx.setLineDash([4 / zoom, 3 / zoom]);
          ctx.strokeRect(sx, sy, sw, sh);
          ctx.setLineDash([]);

          // Label badge
          const dim      = vertical ? sh : sw;
          const fontSize = Math.max(7, Math.min(10, dim * 0.42)) / zoom;
          ctx.font = `bold ${fontSize}px Arial`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillStyle  = applied ? '#0e7566' : '#a04000';
          const label    = applied ? '✂ cross-cut' : '✂ save option';
          ctx.fillText(label, sx + sw / 2, sy + sh / 2);
        };

        if (isAlongLength) {
          const stripY = room.y + fullDropsCC * rollWidthPx;
          const stripH = Math.min(narrowPx, room.y + room.height - stripY);
          drawCCStrip(room.x, stripY, room.width, stripH, true);
        } else {
          const stripX = room.x + fullDropsCC * rollWidthPx;
          const stripW = Math.min(narrowPx, room.x + room.width - stripX);
          drawCCStrip(stripX, room.y, stripW, room.height, false);
        }
      }
    }
    // ── end cross-cut overlay ─────────────────────────────────────────────────

    // ── Step 4: bold red dashed joint lines with J-labels ────────────────────
    ctx.strokeStyle = jointColor;
    ctx.lineWidth   = 3 / zoom;
    ctx.setLineDash([10 / zoom, 5 / zoom]);
    if (isAlongLength) {
      let jy = room.y + rollWidthPx, jn = 1;
      while (jy < room.y + room.height - 1 / zoom) {
        ctx.beginPath();
        ctx.moveTo(room.x, jy);
        ctx.lineTo(room.x + room.width, jy);
        ctx.stroke();
        ctx.save();
        ctx.setLineDash([]);
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${11 / zoom}px Arial`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        // white backing pill
        const lw = 22 / zoom, lh = 14 / zoom;
        ctx.fillStyle = jointColor;
        ctx.fillRect(room.x + 3 / zoom, jy - lh / 2, lw, lh);
        ctx.fillStyle = '#fff';
        ctx.fillText(`J${jn}`, room.x + 5 / zoom, jy);
        ctx.restore();
        jy += rollWidthPx; jn++;
      }
    } else {
      let jx = room.x + rollWidthPx, jn = 1;
      while (jx < room.x + room.width - 1 / zoom) {
        ctx.beginPath();
        ctx.moveTo(jx, room.y);
        ctx.lineTo(jx, room.y + room.height);
        ctx.stroke();
        ctx.save();
        ctx.setLineDash([]);
        const lw = 14 / zoom, lh = 22 / zoom;
        ctx.fillStyle = jointColor;
        ctx.fillRect(jx - lw / 2, room.y + 3 / zoom, lw, lh);
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${11 / zoom}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`J${jn}`, jx, room.y + 3 / zoom + lh / 2);
        ctx.restore();
        jx += rollWidthPx; jn++;
      }
    }

    ctx.restore();
    // ── end carpet visualization ──────────────────────────────────────────────

    // Direction arrow
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.fillStyle   = 'rgba(0,0,0,0.65)';
    ctx.lineWidth   = 2 / zoom;
    ctx.setLineDash([]);

    const cx = room.x + room.width  / 2;
    const cy = room.y + room.height / 2;

    if (isAlongLength) {
      // Horizontal arrow (→)
      const halfLen = Math.min(room.width * 0.22, 35 / zoom);
      const hs      = Math.max(5 / zoom, halfLen * 0.22);
      ctx.beginPath();
      ctx.moveTo(cx - halfLen, cy - 22 / zoom);
      ctx.lineTo(cx + halfLen, cy - 22 / zoom);
      ctx.stroke();
      // arrowhead
      ctx.beginPath();
      ctx.moveTo(cx + halfLen,        cy - 22 / zoom);
      ctx.lineTo(cx + halfLen - hs,   cy - 22 / zoom - hs * 0.6);
      ctx.lineTo(cx + halfLen - hs,   cy - 22 / zoom + hs * 0.6);
      ctx.closePath();
      ctx.fill();
    } else {
      // Vertical arrow (↓)
      const halfLen = Math.min(room.height * 0.22, 35 / zoom);
      const hs      = Math.max(5 / zoom, halfLen * 0.22);
      const arrowX  = cx + Math.min(room.width * 0.28, 28 / zoom);
      ctx.beginPath();
      ctx.moveTo(arrowX, cy - halfLen);
      ctx.lineTo(arrowX, cy + halfLen);
      ctx.stroke();
      // arrowhead
      ctx.beginPath();
      ctx.moveTo(arrowX,            cy + halfLen);
      ctx.lineTo(arrowX - hs * 0.6, cy + halfLen - hs);
      ctx.lineTo(arrowX + hs * 0.6, cy + halfLen - hs);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    // ── end carpet visuals ────────────────────────────────────────────────────

    // Draw special border for combined rooms
    if (room.isCombined) {
      ctx.strokeStyle = '#9b59b6';
      ctx.lineWidth = 4 / zoom;
      ctx.setLineDash([10 / zoom, 5 / zoom]);
      ctx.strokeRect(room.x, room.y, room.width, room.height);
      ctx.setLineDash([]);
    }

    // Draw polygon outline (custom shapes)
    if (room.isPolygon && room.points && room.points.length >= 3) {
      ctx.beginPath();
      ctx.moveTo(room.points[0].x, room.points[0].y);
      room.points.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.closePath();
      ctx.fillStyle = room.color + '33';
      ctx.fill();
      ctx.strokeStyle = room === selectedRoom ? '#2ecc71' : '#34495e';
      ctx.lineWidth = (room === selectedRoom ? 3 : 1.5) / zoom;
      ctx.setLineDash([]);
      ctx.stroke();
    } else {
      ctx.strokeStyle = room === selectedRoom ? '#2ecc71' : '#34495e';
      ctx.lineWidth = (room === selectedRoom ? 3 : 1.5) / zoom;
      ctx.strokeRect(room.x, room.y, room.width, room.height);
    }

    // Draw doors
    room.doors.forEach(door => {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#8B4513';
      ctx.lineWidth = 2 / zoom;
      
      if (door.side === 'top' || door.side === 'bottom') {
        ctx.fillRect(door.x, door.y - 3/zoom, door.width, 6/zoom);
        ctx.strokeRect(door.x, door.y - 3/zoom, door.width, 6/zoom);
        
        if (door.type === 'single') {
          ctx.strokeStyle = '#8B4513';
          ctx.lineWidth = 1 / zoom;
          ctx.beginPath();
          ctx.arc(door.x, door.y, door.width, 
                 door.side === 'top' ? Math.PI : 0, 
                 door.side === 'top' ? 0 : Math.PI);
          ctx.stroke();
        }
      } else {
        ctx.fillRect(door.x - 3/zoom, door.y, 6/zoom, door.width);
        ctx.strokeRect(door.x - 3/zoom, door.y, 6/zoom, door.width);
        
        if (door.type === 'single') {
          ctx.strokeStyle = '#8B4513';
          ctx.lineWidth = 1 / zoom;
          ctx.beginPath();
          ctx.arc(door.x, door.y, door.width, 
                 door.side === 'left' ? -Math.PI/2 : Math.PI/2, 
                 door.side === 'left' ? Math.PI/2 : -Math.PI/2);
          ctx.stroke();
        }
      }
    });
    
    // Labels
    ctx.fillStyle = '#2c3e50';
    ctx.font = `${14 / zoom}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const lengthM = (room.width / ppm).toFixed(2);
    const widthM = (room.height / ppm).toFixed(2);

    const labelCX = room.isPolygon ? polygonCentroid(room.points).x : room.x + room.width / 2;
    const labelCY = room.isPolygon ? polygonCentroid(room.points).y : room.y + room.height / 2;
    ctx.fillText(room.name, labelCX, labelCY - 14/zoom);
    ctx.font = `${11 / zoom}px Arial`;
    const dimLabel = room.isPolygon
      ? `${(polygonArea(room.points)/(ppm*ppm)).toFixed(2)} m²`
      : `${lengthM}m × ${widthM}m`;
    ctx.fillText(dimLabel, labelCX, labelCY + 2/zoom);
    // Direction label
    ctx.font = `bold ${10 / zoom}px Arial`;
    ctx.fillStyle = 'rgba(44,62,80,0.75)';
    const dirLabel = isAlongLength ? '→ runs along length' : '↓ runs along width';
    ctx.fillText(dirLabel, labelCX, labelCY + 16/zoom);
  });

  // ── Polygon-in-progress preview ─────────────────────────────────────────────
  if (mode === 'polygon' && polygonPoints.length > 0) {
    const preview = canvas._polyPreview;
    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);

    // Draw placed points connected
    ctx.beginPath();
    ctx.moveTo(polygonPoints[0].x, polygonPoints[0].y);
    for (let i = 1; i < polygonPoints.length; i++) ctx.lineTo(polygonPoints[i].x, polygonPoints[i].y);

    // Line to cursor
    if (preview) ctx.lineTo(preview.x, preview.y);

    ctx.strokeStyle = '#3498db';
    ctx.lineWidth = 2 / zoom;
    ctx.setLineDash([6 / zoom, 4 / zoom]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Filled preview polygon (3+ points + cursor)
    if (preview && polygonPoints.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(polygonPoints[0].x, polygonPoints[0].y);
      polygonPoints.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.lineTo(preview.x, preview.y);
      ctx.closePath();
      ctx.fillStyle = 'rgba(52,152,219,0.12)';
      ctx.fill();
    }

    // Draw placed point dots
    polygonPoints.forEach((p, i) => {
      const snapDist = 12 / zoom;
      const isFirst = i === 0;
      const nearFirst = isFirst && preview && Math.hypot(preview.x - p.x, preview.y - p.y) < snapDist && polygonPoints.length >= 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, (isFirst ? 6 : 4) / zoom, 0, Math.PI * 2);
      ctx.fillStyle = nearFirst ? '#2ecc71' : (isFirst ? '#e74c3c' : '#3498db');
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5 / zoom;
      ctx.stroke();
    });

    // Snap-close hint ring around first point
    if (preview && polygonPoints.length >= 3) {
      const fp = polygonPoints[0];
      const snapDist = 12 / zoom;
      if (Math.hypot(preview.x - fp.x, preview.y - fp.y) < snapDist) {
        ctx.beginPath();
        ctx.arc(fp.x, fp.y, snapDist, 0, Math.PI * 2);
        ctx.strokeStyle = '#2ecc71';
        ctx.lineWidth = 1.5 / zoom;
        ctx.setLineDash([3 / zoom, 3 / zoom]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    ctx.restore();
  }

  ctx.restore();
  autoSave();
}
