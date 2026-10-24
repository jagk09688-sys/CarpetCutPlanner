// Global state variables
let rooms = [];
let doors = [];
let freehandPaths = [];
let currentPath = null;
let selectedRoom = null;
let mode = 'draw';
let drawing = false;
let startX, startY;
let dragging = false;
let dragRoom = null;
let dragOffsetX, dragOffsetY;
let zoom = 1;
let panX = 0, panY = 0;
let panMode = false;
let lastPanX, lastPanY;
let roomCounter = 1;
let currentPlanId = null;
let bgImage = null;
let editingDoor = null;
let editingRoom = null;

// Polygon drawing state
let polygonPoints = [];
let polygonSnapping = false;

// Live dimension display element
let dimensionLabel = null;

// ── Live Dimension Functions ──────────────────────────────────────────────────

function createDimensionLabel() {
  if (dimensionLabel) return;
  dimensionLabel = document.createElement('div');
  dimensionLabel.id = 'live-dimension';
  dimensionLabel.style.cssText = `
    position: fixed;
    background: rgba(15, 23, 42, 0.95);
    color: #22d3ee;
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 13px;
    font-family: 'SF Mono', 'Consolas', monospace;
    font-weight: 600;
    pointer-events: none;
    display: none;
    z-index: 10000;
    border: 1px solid #0ea5e9;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    white-space: nowrap;
  `;
  document.body.appendChild(dimensionLabel);
}

function showDimension(text, clientX, clientY) {
  if (!dimensionLabel) createDimensionLabel();
  dimensionLabel.textContent = text;
  dimensionLabel.style.left = `${clientX + 20}px`;
  dimensionLabel.style.top = `${clientY + 20}px`;
  dimensionLabel.style.display = 'block';
}

function hideDimension() {
  if (dimensionLabel) {
    dimensionLabel.style.display = 'none';
  }
}

// Draw dimension lines on the preview rectangle while drawing
function drawPreviewDimensions(ctx, x1, y1, x2, y2, ppm) {
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  const width = maxX - minX;
  const height = maxY - minY;
  
  const widthM = (width / ppm).toFixed(2);
  const heightM = (height / ppm).toFixed(2);
  
  ctx.font = `bold ${12 / zoom}px Arial`;
  ctx.fillStyle = '#22d3ee';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  
  // Width label (top)
  const dimOffset = 20 / zoom;
  ctx.fillText(`${widthM}m`, minX + width / 2, minY - dimOffset);
  
  // Height label (left side)
  ctx.save();
  ctx.translate(minX - dimOffset, minY + height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(`${heightM}m`, 0, 0);
  ctx.restore();
  
  // Draw dimension lines
  ctx.strokeStyle = '#22d3ee';
  ctx.lineWidth = 1 / zoom;
  
  // Top dimension line
  ctx.beginPath();
  ctx.moveTo(minX, minY - dimOffset / 2);
  ctx.lineTo(maxX, minY - dimOffset / 2);
  ctx.stroke();
  
  // Left dimension line
  ctx.beginPath();
  ctx.moveTo(minX - dimOffset / 2, minY);
  ctx.lineTo(minX - dimOffset / 2, maxY);
  ctx.stroke();
}

// Draw permanent dimensions on completed rooms
function drawRoomDimensions(ctx, room, ppm) {
  if (room.isPolygon) {
    const pts = room.points;
    ctx.font = `${10 / zoom}px Arial`;
    ctx.fillStyle = '#94a3b8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      const midX = (pts[i].x + pts[j].x) / 2;
      const midY = (pts[i].y + pts[j].y) / 2;
      const lenM = (Math.hypot(pts[j].x - pts[i].x, pts[j].y - pts[i].y) / ppm).toFixed(2);
      
      const dx = pts[j].x - pts[i].x;
      const dy = pts[j].y - pts[i].y;
      const len = Math.hypot(dx, dy);
      if (len > 0) {
        const nx = -dy / len * (15 / zoom);
        const ny = dx / len * (15 / zoom);
        ctx.fillText(`${lenM}m`, midX + nx, midY + ny);
      }
    }
  } else {
    const widthM = (room.width / ppm).toFixed(2);
    const heightM = (room.height / ppm).toFixed(2);
    
    ctx.font = `${11 / zoom}px Arial`;
    ctx.fillStyle = '#cbd5e1';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Width (top)
    ctx.fillText(`${widthM}m`, room.x + room.width / 2, room.y - 12 / zoom);
    
    // Height (right side, rotated)
    ctx.save();
    ctx.translate(room.x + room.width + 12 / zoom, room.y + room.height / 2);
    ctx.rotate(Math.PI / 2);
    ctx.fillText(`${heightM}m`, 0, 0);
    ctx.restore();
  }
}

// ── Set drawing mode ──────────────────────────────────────────────────────────

function setMode(m) {
  mode = m;
  document.getElementById('btnDraw').classList.remove('active');
  document.getElementById('btnSelect').classList.remove('active');
  document.getElementById('btnDoor').classList.remove('active');
  document.getElementById('btnFreehand').classList.remove('active');
  document.getElementById('btnErase').classList.remove('active');
  if (document.getElementById('btnPolygon')) document.getElementById('btnPolygon').classList.remove('active');

  if (mode === 'polygon' && m !== 'polygon') {
    polygonPoints = [];
    if (typeof draw === 'function') draw();
  }

  if (m === 'draw') {
    document.getElementById('btnDraw').classList.add('active');
    canvas.style.cursor = 'crosshair';
  } else if (m === 'polygon') {
    if (document.getElementById('btnPolygon')) document.getElementById('btnPolygon').classList.add('active');
    canvas.style.cursor = 'crosshair';
  } else if (m === 'select') {
    document.getElementById('btnSelect').classList.add('active');
    canvas.style.cursor = 'move';
  } else if (m === 'door') {
    document.getElementById('btnDoor').classList.add('active');
    canvas.style.cursor = 'crosshair';
  } else if (m === 'freehand') {
    document.getElementById('btnFreehand').classList.add('active');
    canvas.style.cursor = 'crosshair';
  } else if (m === 'erase') {
    document.getElementById('btnErase').classList.add('active');
    canvas.style.cursor = 'pointer';
  }
  updateInfo();
}

function updateInfo() {
  const info = document.getElementById('info');
  const panStatus = document.getElementById('panStatus');
  
  panStatus.textContent = panMode ? 'Pan On' : 'Pan Off';
  
  if (mode === 'draw') {
    info.textContent = 'Click and drag to draw rooms';
  } else if (mode === 'polygon') {
    info.textContent = polygonPoints.length === 0
      ? 'Click to place corners — double-click or click first point to close shape'
      : `Polygon: ${polygonPoints.length} point(s) — double-click or click first point to finish (Esc to cancel)`;
  } else if (mode === 'select') {
    info.textContent = 'Click and drag rooms to move them';
  } else if (mode === 'door') {
    info.textContent = 'Click on a room edge to add a door';
  } else if (mode === 'freehand') {
    info.textContent = 'Click and drag to draw (lines auto-straighten)';
  } else if (mode === 'erase') {
    info.textContent = 'Click on freehand drawings to erase them';
  }
}

// Get pixels per meter
function getPxPerMeter() {
  return parseFloat(document.getElementById('pxPerMeter').value);
}

// Utility functions
function getRandomColor() {
  const colors = ['#3498db', '#e74c3c', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22'];
  return colors[Math.floor(Math.random() * colors.length)];
}

// ── Room management ───────────────────────────────────────────────────────────

function updateRoomsList() {
  const list = document.getElementById('roomsList');
  list.innerHTML = '';
  
  const ppm = getPxPerMeter();
  
  rooms.forEach(room => {
    const div = document.createElement('div');
    div.className = 'room-item' + (room === selectedRoom ? ' selected' : '');
    div.onclick = () => {
      selectedRoom = room;
      updateRoomsList();
      draw();
    };
    
    const lengthM = (room.width / ppm).toFixed(2);
    const widthM = (room.height / ppm).toFixed(2);
    const areaM2 = room.isPolygon
      ? (polygonArea(room.points) / (ppm * ppm)).toFixed(2)
      : null;
    
    let doorsHTML = '';
    if (room.doors.length > 0) {
      doorsHTML = '<div class="door-list"><strong>Doors:</strong>';
      room.doors.forEach(door => {
        const doorWidthM = (door.width / ppm).toFixed(2);
        doorsHTML += `
          <div class="door-item">
            <span>${door.type} (${doorWidthM}m) - ${door.side}</span>
            <button onclick="editDoor(${room.id}, ${door.id}); event.stopPropagation();" style="background:#0f766e;color:#fff;padding:4px 8px;border:none;border-radius:3px;cursor:pointer;font-size:0.8em;margin-right:4px;">✎</button>
            <button onclick="deleteDoor(${room.id}, ${door.id}); event.stopPropagation();">×</button>
          </div>
        `;
      });
      doorsHTML += '</div>';
    }
    
    let combinedBadge = '';
    let splitButton = '';
    if (room.isCombined) {
      combinedBadge = '<span class="combined-badge">✨ Combined Room</span>';
      splitButton = `<button class="btn-split" onclick="splitRoom(${room.id}); event.stopPropagation();">Split Back</button>`;
    }
    
    div.innerHTML = `
      <button onclick="deleteRoom(${room.id}); event.stopPropagation();">Delete</button>
      ${splitButton}
      <span class="color-indicator" style="background: ${room.color};"></span>
      <input type="text" value="${room.name}" 
             onchange="renameRoom(${room.id}, this.value)"
             onclick="event.stopPropagation()">
      ${combinedBadge}
      <div class="room-dims">
        ${room.isPolygon ? buildPolygonDimsHTML(room, ppm) : `📏
        <label style="color:#ecf0f1;font-size:0.85em;">L:</label>
        <input type="number" class="dim-input" step="0.01" min="0.1" value="${lengthM}"
               onchange="resizeRoom(${room.id}, parseFloat(this.value), parseFloat(this.parentNode.querySelector('.dim-w').value))"
               onclick="event.stopPropagation()">m ×
        <label style="color:#ecf0f1;font-size:0.85em;">W:</label>
        <input type="number" class="dim-input dim-w" step="0.01" min="0.1" value="${widthM}"
               onchange="resizeRoom(${room.id}, parseFloat(this.parentNode.querySelector('.dim-input').value), parseFloat(this.value))"
               onclick="event.stopPropagation()">m`}
      </div>
      ${doorsHTML}
      <select onchange="setOrientation(${room.id}, this.value)"
              onclick="event.stopPropagation()">
        <option value="auto"   ${(!room.orientation || room.orientation === 'auto')   ? 'selected' : ''}>Auto (min joints)</option>
        <option value="length" ${room.orientation === 'length' ? 'selected' : ''}>Carpet Along Length</option>
        <option value="width"  ${room.orientation === 'width'  ? 'selected' : ''}>Carpet Along Width</option>
      </select>
      <label style="display:flex;align-items:center;gap:6px;margin-top:6px;font-size:0.82em;color:#c8d0e0;cursor:pointer;" onclick="event.stopPropagation()">
        <input type="checkbox" ${room.splitJoin ? 'checked' : ''}
               onchange="setSplitJoin(${room.id}, this.checked)"
               onclick="event.stopPropagation()"
               style="accent-color:#a855f7;width:14px;height:14px;cursor:pointer;">
        Allow split-join on narrow strip
        <span style="font-size:0.9em;color:#a78bfa;" title="Assembles the last narrow strip from two shorter pieces joined end-to-end. Saves roll if offcuts are available. Plain/loop-pile carpet only — pattern will not match at seam.">&#9432;</span>
      </label>
    `;

    list.appendChild(div);
  });
}

function splitRoom(roomId) {
  const room = rooms.find(r => r.id === roomId);
  if (!room || !room.isCombined || !room.originalRoomData) {
    alert('Cannot split this room - original room data not found.');
    return;
  }
  
  room.originalRoomData.forEach(origRoom => {
    rooms.push(origRoom);
  });
  
  rooms = rooms.filter(r => r.id !== roomId);
  
  selectedRoom = null;
  updateRoomsList();
  draw();
  
  alert('Room split back into original rooms!');
}

function addRoomByDimension() {
  document.getElementById('armName').value   = `Room ${roomCounter}`;
  document.getElementById('armLength').value = '';
  document.getElementById('armWidth').value  = '';
  document.getElementById('armError').style.display = 'none';

  const modal = document.getElementById('addRoomModal');
  modal.style.display = 'flex';

  setTimeout(() => {
    const nameEl = document.getElementById('armName');
    nameEl.focus();
    nameEl.select();
  }, 50);
}

function closeAddRoomModal() {
  document.getElementById('addRoomModal').style.display = 'none';
}

function confirmAddRoom() {
  const name    = document.getElementById('armName').value.trim() || `Room ${roomCounter}`;
  const lengthM = parseFloat(document.getElementById('armLength').value);
  const widthM  = parseFloat(document.getElementById('armWidth').value);

  const errEl = document.getElementById('armError');
  if (isNaN(lengthM) || lengthM <= 0 || isNaN(widthM) || widthM <= 0) {
    errEl.textContent = 'Please enter a valid length and width (both must be greater than 0).';
    errEl.style.display = 'block';
    return;
  }
  errEl.style.display = 'none';

  const ppm = getPxPerMeter();

  const padding = 20;
  let placeX = padding, placeY = padding;
  if (rooms.length > 0) {
    const last = rooms[rooms.length - 1];
    placeX = last.x + last.width + padding;
    placeY = last.y;
    const canvasEl = document.getElementById('canvas');
    if (placeX + lengthM * ppm > (canvasEl.width - panX) / zoom) {
      placeX = padding;
      placeY = last.y + last.height + padding;
    }
  }

  const room = {
    id:          Date.now(),
    name:        name,
    x:           placeX,
    y:           placeY,
    width:       lengthM * ppm,
    height:      widthM  * ppm,
    orientation: 'auto',
    color:       getRandomColor(),
    doors:       []
  };

  rooms.push(room);
  roomCounter++;
  selectedRoom = room;
  updateRoomsList();
  draw();
  closeAddRoomModal();
}

function renameRoom(id, name) {
  const room = rooms.find(r => r.id === id);
  if (room) {
    room.name = name;
    draw();
  }
}

function resizeRoom(id, lengthM, widthM) {
  const room = rooms.find(r => r.id === id);
  if (!room || isNaN(lengthM) || isNaN(widthM) || lengthM <= 0 || widthM <= 0) return;
  const ppm = getPxPerMeter();
  room.width = lengthM * ppm;
  room.height = widthM * ppm;
  draw();
}

function setSplitJoin(id, enabled) {
  const room = rooms.find(r => r.id === id);
  if (room) {
    room.splitJoin = enabled;
    if (document.getElementById('results').innerHTML.trim() !== '') {
      calculate();
    }
  }
}

function setOrientation(id, orientation) {
  const room = rooms.find(r => r.id === id);
  if (room) {
    room.orientation = orientation;
    draw();
    if (document.getElementById('results').innerHTML.trim() !== '') {
      calculate();
    }
  }
}

function deleteRoom(id) {
  rooms = rooms.filter(r => r.id !== id);
  doors = doors.filter(d => d.roomId !== id);
  selectedRoom = null;
  updateRoomsList();
  draw();
}

function deleteDoor(roomId, doorId) {
  const room = rooms.find(r => r.id === roomId);
  if (room) {
    room.doors = room.doors.filter(d => d.id !== doorId);
    doors = doors.filter(d => d.id !== doorId);
    updateRoomsList();
    draw();
  }
}

// ── Edit door functions ───────────────────────────────────────────────────────

function editDoor(roomId, doorId) {
  const room = rooms.find(r => r.id === roomId);
  if (!room) return;
  
  const door = room.doors.find(d => d.id === doorId);
  if (!door) return;
  
  editingDoor = door;
  editingRoom = room;
  
  const ppm = getPxPerMeter();
  const doorWidthM = (door.width / ppm).toFixed(2);
  
  document.getElementById('edDoorType').value = door.type;
  document.getElementById('edDoorWidth').value = doorWidthM;
  document.getElementById('edDoorSide').textContent = door.side.charAt(0).toUpperCase() + door.side.slice(1);
  
  const modal = document.getElementById('editDoorModal');
  modal.style.display = 'flex';
}

function closeEditDoorModal() {
  document.getElementById('editDoorModal').style.display = 'none';
  editingDoor = null;
  editingRoom = null;
}

function confirmEditDoor() {
  if (!editingDoor || !editingRoom) return;
  
  const doorType = document.getElementById('edDoorType').value;
  const doorWidthM = parseFloat(document.getElementById('edDoorWidth').value);
  const ppm = getPxPerMeter();
  
  if (isNaN(doorWidthM) || doorWidthM <= 0) {
    alert('Please enter a valid door width.');
    return;
  }
  
  editingDoor.type = doorType;
  editingDoor.width = doorWidthM * ppm;
  
  closeEditDoorModal();
  updateRoomsList();
  draw();
}

function removeEditingDoor() {
  if (!editingDoor || !editingRoom) return;
  
  if (confirm('Remove this door?')) {
    editingRoom.doors = editingRoom.doors.filter(d => d.id !== editingDoor.id);
    doors = doors.filter(d => d.id !== editingDoor.id);
    closeEditDoorModal();
    updateRoomsList();
    draw();
  }
}

// ── Door functions ────────────────────────────────────────────────────────────

function addDoorAtPosition(x, y) {
  for (let room of rooms) {
    const edges = [
      {side: 'top', x1: room.x, y1: room.y, x2: room.x + room.width, y2: room.y},
      {side: 'right', x1: room.x + room.width, y1: room.y, x2: room.x + room.width, y2: room.y + room.height},
      {side: 'bottom', x1: room.x, y1: room.y + room.height, x2: room.x + room.width, y2: room.y + room.height},
      {side: 'left', x1: room.x, y1: room.y, x2: room.x, y2: room.y + room.height}
    ];

    for (let edge of edges) {
      const dist = distanceToLineSegment(x, y, edge.x1, edge.y1, edge.x2, edge.y2);
      if (dist < 20 / zoom) {
        const doorWidth = parseFloat(document.getElementById('doorWidth').value) * getPxPerMeter();
        const doorType = document.getElementById('doorType').value;
        
        let doorX, doorY;
        if (edge.side === 'top' || edge.side === 'bottom') {
          doorX = Math.max(edge.x1, Math.min(edge.x2 - doorWidth, x - doorWidth / 2));
          doorY = edge.y1;
        } else {
          doorX = edge.x1;
          doorY = Math.max(edge.y1, Math.min(edge.y2 - doorWidth, y - doorWidth / 2));
        }

        const door = {
          id: Date.now(),
          roomId: room.id,
          x: doorX,
          y: doorY,
          width: doorWidth,
          side: edge.side,
          type: doorType
        };

        room.doors.push(door);
        doors.push(door);
        updateRoomsList();
        draw();
        return;
      }
    }
  }
}

function distanceToLineSegment(px, py, x1, y1, x2, y2) {
  const A = px - x1;
  const B = py - y1;
  const C = x2 - x1;
  const D = y2 - y1;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;
  
  if (lenSq !== 0) param = dot / lenSq;

  let xx, yy;

  if (param < 0) {
    xx = x1;
    yy = y1;
  } else if (param > 1) {
    xx = x2;
    yy = y2;
  } else {
    xx = x1 + param * C;
    yy = y1 + param * D;
  }

  const dx = px - xx;
  const dy = py - yy;
  return Math.sqrt(dx * dx + dy * dy);
}

// ── Freehand functions ────────────────────────────────────────────────────────

function eraseFreehandAt(x, y) {
  for (let i = freehandPaths.length - 1; i >= 0; i--) {
    const path = freehandPaths[i];
    for (let point of path.points) {
      const dist = Math.sqrt((point.x - x) ** 2 + (point.y - y) ** 2);
      if (dist < 10 / zoom) {
        freehandPaths.splice(i, 1);
        draw();
        return;
      }
    }
  }
}

function clearFreehand() {
  if (confirm('Clear all freehand drawings?')) {
    freehandPaths = [];
    draw();
  }
}

function straightenPath(points) {
  if (points.length < 2) return points;

  const threshold = 15;
  const straightened = [points[0]];

  for (let i = 1; i < points.length; i++) {
    const prev = straightened[straightened.length - 1];
    const curr = points[i];

    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;

    if (Math.abs(angle) < threshold || Math.abs(angle - 180) < threshold || Math.abs(angle + 180) < threshold) {
      straightened.push({x: curr.x, y: prev.y});
    }
    else if (Math.abs(angle - 90) < threshold || Math.abs(angle + 90) < threshold) {
      straightened.push({x: prev.x, y: curr.y});
    }
    else {
      straightened.push(curr);
    }
  }

  return straightened;
}

// ── Polygon room helpers ──────────────────────────────────────────────────────

function polygonSignedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return a / 2;
}

function polygonArea(pts) { return Math.abs(polygonSignedArea(pts)); }

function polygonCentroid(pts) {
  let cx = 0, cy = 0;
  const a = polygonSignedArea(pts);
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    const f = pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    cx += (pts[i].x + pts[j].x) * f;
    cy += (pts[i].y + pts[j].y) * f;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

function polygonBBox(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  pts.forEach(p => { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); });
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function pointInPolygon(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

function finalisePolygon(pts) {
  if (pts.length < 3) return;
  if (polygonSignedArea(pts) < 0) pts = pts.slice().reverse();
  const bb = polygonBBox(pts);
  const room = {
    id: Date.now(),
    name: `Room ${roomCounter++}`,
    points: pts,
    isPolygon: true,
    x: bb.x, y: bb.y, width: bb.width, height: bb.height,
    orientation: 'auto',
    color: getRandomColor(),
    doors: []
  };
  rooms.push(room);
  selectedRoom = room;
  polygonPoints = [];
  updateRoomsList();
  draw();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && mode === 'polygon' && polygonPoints.length > 0) {
    polygonPoints = [];
    draw();
    updateInfo();
  }
});

// ── Polygon dimension editing ─────────────────────────────────────────────────

function buildPolygonDimsHTML(room, ppm) {
  const pts = room.points;
  const n = pts.length;
  const areaM2 = (polygonArea(pts) / (ppm * ppm)).toFixed(2);

  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  let sidesHTML = '';
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const lenM = (Math.hypot(pts[j].x - pts[i].x, pts[j].y - pts[i].y) / ppm).toFixed(2);
    const sideLabel = alpha[i] + alpha[j];
    sidesHTML += `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;" onclick="event.stopPropagation()">
        <span style="color:#a78bfa;font-size:0.82em;font-weight:700;min-width:32px;">${sideLabel}</span>
        <input type="number" step="0.01" min="0.01" value="${lenM}"
               style="width:70px;padding:3px 6px;border-radius:4px;border:1px solid #475569;background:#0f172a;color:#f1f5f9;font-size:0.85em;"
               onchange="resizePolygonSide(${room.id}, ${i}, parseFloat(this.value))"
               onclick="event.stopPropagation()">
        <span style="color:#94a3b8;font-size:0.8em;">m</span>
      </div>`;
  }

  return `
    <div style="color:#a78bfa;font-size:0.82em;font-weight:700;margin-bottom:6px;">
      📐 Custom Shape &nbsp;<span style="color:#64748b;font-weight:400;">Area: ${areaM2} m²</span>
    </div>
    <div style="color:#64748b;font-size:0.72em;margin-bottom:5px;">Edit side lengths:</div>
    ${sidesHTML}`;
}

function resizePolygonSide(roomId, sideIdx, newLenM) {
  const room = rooms.find(r => r.id === roomId);
  if (!room || !room.isPolygon || isNaN(newLenM) || newLenM <= 0) return;
  const ppm = getPxPerMeter();
  const pts = room.points;
  const n = pts.length;
  const i = sideIdx;
  const j = (i + 1) % n;

  const dx = pts[j].x - pts[i].x;
  const dy = pts[j].y - pts[i].y;
  const currentLen = Math.hypot(dx, dy);
  if (currentLen < 0.001) return;
  const ux = dx / currentLen;
  const uy = dy / currentLen;

  pts[j] = {
    x: pts[i].x + ux * newLenM * ppm,
    y: pts[i].y + uy * newLenM * ppm
  };

  const bb = polygonBBox(pts);
  room.x = bb.x; room.y = bb.y; room.width = bb.width; room.height = bb.height;
  draw();
}

function deletePolygonPoint(roomId, idx) {
  const room = rooms.find(r => r.id === roomId);
  if (!room || !room.isPolygon || room.points.length <= 3) {
    alert('A polygon needs at least 3 corners.');
    return;
  }
  room.points.splice(idx, 1);
  const bb = polygonBBox(room.points);
  room.x = bb.x; room.y = bb.y; room.width = bb.width; room.height = bb.height;
  updateRoomsList();
  draw();
}

function addPolygonPoint(roomId) {
  const room = rooms.find(r => r.id === roomId);
  if (!room || !room.isPolygon) return;
  const pts = room.points;
  const last = pts[pts.length - 1];
  const first = pts[0];
  const mid = { x: (last.x + first.x) / 2, y: (last.y + first.y) / 2 };
  pts.push(mid);
  const bb = polygonBBox(pts);
  room.x = bb.x; room.y = bb.y; room.width = bb.width; room.height = bb.height;
  updateRoomsList();
  draw();
}

function applyPolygonScale(roomId) {
  const room = rooms.find(r => r.id === roomId);
  if (!room || !room.isPolygon) return;
  const el = document.getElementById(`polyScale_${roomId}`);
  const pct = parseFloat(el ? el.value : 100);
  if (isNaN(pct) || pct <= 0) { alert('Enter a valid scale percentage (e.g. 150 for 150%).'); return; }
  const factor = pct / 100;
  const c = polygonCentroid(room.points);
  room.points = room.points.map(p => ({
    x: c.x + (p.x - c.x) * factor,
    y: c.y + (p.y - c.y) * factor
  }));
  const bb = polygonBBox(room.points);
  room.x = bb.x; room.y = bb.y; room.width = bb.width; room.height = bb.height;
  if (el) el.value = 100;
  updateRoomsList();
  draw();
}

// ── Zoom controls ─────────────────────────────────────────────────────────────

function zoomIn() {
  const oldZoom = zoom;
  zoom *= 1.2;
  const canvas = document.getElementById('canvas');
  panX = (panX - canvas.width / 2) * (zoom / oldZoom) + canvas.width / 2;
  panY = (panY - canvas.height / 2) * (zoom / oldZoom) + canvas.height / 2;
  draw();
}

function zoomOut() {
  const oldZoom = zoom;
  zoom /= 1.2;
  const canvas = document.getElementById('canvas');
  panX = (panX - canvas.width / 2) * (zoom / oldZoom) + canvas.width / 2;
  panY = (panY - canvas.height / 2) * (zoom / oldZoom) + canvas.height / 2;
  draw();
}

function resetZoom() {
  zoom = 1;
  panX = 0;
  panY = 0;
  draw();
}

function clearAll() {
  if (confirm('Clear all rooms, doors, and freehand drawings?')) {
    rooms = [];
    doors = [];
    freehandPaths = [];
    selectedRoom = null;
    roomCounter = 1;
    currentPlanId = null;
    document.getElementById('currentPlanId').style.display = 'none';
    updateRoomsList();
    draw();
    document.getElementById('results').innerHTML = '';
  }
}

function ensurePdfJsWorkerPath() {
  if (typeof pdfjsLib !== 'undefined' && pdfjsLib && pdfjsLib.GlobalWorkerOptions) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = '[cdnjs.cloudflare.com](https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js)';
    console.log('PDF.js worker configured:', pdfjsLib.GlobalWorkerOptions.workerSrc);
  }
}

// ── Background image ──────────────────────────────────────────────────────────

function updateBgStatus(message, isError = false) {
  const statusEl = document.getElementById('bgStatus');
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#ef4444' : '#d1d5db';
}

function loadBgImage(input) {
  const file = input.files[0];
  if (!file) return;
  updateBgStatus('Loading file...');
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    if (typeof pdfjsLib === 'undefined') {
      updateBgStatus('PDF.js is not available. Refresh the page.', true);
      console.error('PDF.js library not loaded: pdfjsLib is undefined');
      return;
    }
    ensurePdfJsWorkerPath();
    renderPdfPageToBlob(file).then(blob => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        bgImage = img;
        draw();
        URL.revokeObjectURL(url);
        updateBgStatus('PDF loaded successfully.');
      };
      img.onerror = (e) => {
        console.error('Failed to load rendered PDF image', e);
        URL.revokeObjectURL(url);
        updateBgStatus('Failed to render PDF page as image.', true);
        alert('Failed to render PDF page as image.');
      };
      img.src = url;
    }).catch(err => {
      console.error('PDF render failed', err);
      updateBgStatus('Failed to load PDF. See console for details.', true);
      alert('Failed to load PDF. Make sure PDF.js is included and the file is valid.');
    });
    return;
  }

  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => { bgImage = img; draw(); updateBgStatus('Image loaded successfully.'); };
    img.onerror = err => { console.error('Image load failed', err); updateBgStatus('Failed to load image.', true); };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function clearBgImage() {
  bgImage = null;
  document.getElementById('bgImageInput').value = '';
  updateBgStatus('Background removed.');
  draw();
}

function renderPdfPageToBlob(file) {
  return new Promise((resolve, reject) => {
    try {
      const url = URL.createObjectURL(file);
      const loadingTask = pdfjsLib.getDocument(url);
      loadingTask.promise.then(pdf => {
        return pdf.getPage(1);
      }).then(page => {
        const canvasEl = document.getElementById('canvas');
        const containerW = (canvasEl && canvasEl.clientWidth) ? canvasEl.clientWidth : 1200;
        const viewport = page.getViewport({ scale: 1 });
        const scale = Math.max(1, containerW / viewport.width);
        const vp = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = vp.width;
        canvas.height = vp.height;
        const ctx = canvas.getContext('2d');
        const renderTask = page.render({ canvasContext: ctx, viewport: vp });
        renderTask.promise.then(() => {
          canvas.toBlob(blob => {
            URL.revokeObjectURL(url);
            if (!blob) return reject(new Error('Failed to convert canvas to blob'));
            resolve(blob);
          }, 'image/png');
        }).catch(err => { URL.revokeObjectURL(url); reject(err); });
      }).catch(err => { URL.revokeObjectURL(url); reject(err); });
    } catch (err) { reject(err); }
  });
}

async function autoImportRooms() {
  const input = document.getElementById('bgImageInput');
  const file = input.files[0];
  if (!file) { alert('Please select a background image first (Upload Image).'); return; }

  try {
    const orig = document.getElementById('info');
    const old = orig.textContent;
    orig.textContent = 'Detecting rooms — please wait...';
    let res;
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      if (typeof pdfjsLib === 'undefined') {
        alert('PDF.js is not available. Please refresh the page or check your network connection.');
        console.error('PDF.js library not loaded: pdfjsLib is undefined');
        orig.textContent = old;
        return;
      }
      ensurePdfJsWorkerPath();
      const blob = await renderPdfPageToBlob(file);
      const imgFile = new File([blob], 'page1.png', { type: 'image/png' });
      res = await window.importDetectedRooms(imgFile, { assignNames: true });
    } else {
      res = await window.importDetectedRooms(file, { assignNames: true });
    }
    orig.textContent = `Imported ${res.created.length} rooms.`; 
    updateRoomsList(); draw();
    console.log('Auto-import result:', res);
    setTimeout(()=> orig.textContent = old, 3000);
    alert(`Imported ${res.created.length} rooms. Check the right panel to adjust names/dimensions.`);
  } catch (err) {
    console.error(err);
    alert('Auto import failed: ' + err.message);
  }
}

// ── Main draw function ────────────────────────────────────────────────────────

function draw() {
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  const ppm = getPxPerMeter();
  
  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  ctx.save();
  ctx.translate(panX, panY);
  ctx.scale(zoom, zoom);
  
  // Draw background image
  if (bgImage) {
    const opacity = parseFloat(document.getElementById('bgOpacity')?.value || 0.5);
    ctx.globalAlpha = opacity;
    ctx.drawImage(bgImage, 0, 0);
    ctx.globalAlpha = 1;
  }
  
  // Draw grid
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 0.5 / zoom;
  const gridSize = ppm;
  const startX = Math.floor(-panX / zoom / gridSize) * gridSize;
  const startY = Math.floor(-panY / zoom / gridSize) * gridSize;
  const endX = startX + canvas.width / zoom + gridSize * 2;
  const endY = startY + canvas.height / zoom + gridSize * 2;
  
  for (let x = startX; x < endX; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, startY);
    ctx.lineTo(x, endY);
    ctx.stroke();
  }
  for (let y = startY; y < endY; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(startX, y);
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
  
  // Draw rooms
  rooms.forEach(room => {
    const isSelected = room === selectedRoom;
    
    if (room.isPolygon) {
      // Draw polygon room
      ctx.fillStyle = room.color + '40';
      ctx.strokeStyle = isSelected ? '#22d3ee' : room.color;
      ctx.lineWidth = (isSelected ? 3 : 2) / zoom;
      
      ctx.beginPath();
      ctx.moveTo(room.points[0].x, room.points[0].y);
      for (let i = 1; i < room.points.length; i++) {
        ctx.lineTo(room.points[i].x, room.points[i].y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      
      // Draw corner markers
      room.points.forEach((pt, idx) => {
        ctx.fillStyle = isSelected ? '#22d3ee' : '#fff';
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 4 / zoom, 0, Math.PI * 2);
        ctx.fill();  
      });
    } else {
      // Draw rectangle room
      ctx.fillStyle = room.color + '40';
      ctx.strokeStyle = isSelected ? '#22d3ee' : room.color;
      ctx.lineWidth = (isSelected ? 3 : 2) / zoom;
      ctx.fillRect(room.x, room.y, room.width, room.height);
      ctx.strokeRect(room.x, room.y, room.width, room.height);
    }
    
    // Draw room name
    ctx.fillStyle = '#f1f5f9';
    ctx.font = `bold ${14 / zoom}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    if (room.isPolygon) {
      const centroid = polygonCentroid(room.points);
      ctx.fillText(room.name, centroid.x, centroid.y);
    } else {
      ctx.fillText(room.name, room.x + room.width / 2, room.y + room.height / 2);
    }
    
    // Draw room dimensions
    drawRoomDimensions(ctx, room, ppm);
    
    // Draw doors
    room.doors.forEach(door => {
      ctx.fillStyle = '#fbbf24';
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2 / zoom;
      
      if (door.side === 'top' || door.side === 'bottom') {
        ctx.fillRect(door.x, door.y - 3 / zoom, door.width, 6 / zoom);
        ctx.strokeRect(door.x, door.y - 3 / zoom, door.width, 6 / zoom);
      } else {
        ctx.fillRect(door.x - 3 / zoom, door.y, 6 / zoom, door.width);
        ctx.strokeRect(door.x - 3 / zoom, door.y, 6 / zoom, door.width);
      }
    });
  });
  
  // Draw polygon in progress
  if (mode === 'polygon' && polygonPoints.length > 0) {
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 2 / zoom;
    ctx.fillStyle = '#22d3ee20';
    
    ctx.beginPath();
    ctx.moveTo(polygonPoints[0].x, polygonPoints[0].y);
    for (let i = 1; i < polygonPoints.length; i++) {
      ctx.lineTo(polygonPoints[i].x, polygonPoints[i].y);
    }
    ctx.stroke();
    
    // Draw points
    polygonPoints.forEach((pt, idx) => {
      ctx.fillStyle = idx === 0 && polygonSnapping ? '#22c55e' : '#22d3ee';
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, (idx === 0 ? 8 : 5) / zoom, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  
  ctx.restore();
}

// ── Canvas event handlers with live dimensions ────────────────────────────────

const canvas = document.getElementById('canvas');

canvas.addEventListener('mousedown', (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left - panX) / zoom;
  const y = (e.clientY - rect.top - panY) / zoom;

  if (panMode) {
    dragging = true;
    lastPanX = e.clientX;
    lastPanY = e.clientY;
    return;
  }

  if (mode === 'draw') {
    drawing = true;
    startX = x;
    startY = y;
  } else if (mode === 'polygon') {
    if (polygonPoints.length >= 3) {
      const first = polygonPoints[0];
      const dist = Math.hypot(x - first.x, y - first.y);
      if (dist < 15 / zoom) {
        finalisePolygon(polygonPoints.slice());
        hideDimension();
        return;
      }
    }
    polygonPoints.push({ x, y });
    updateInfo();
    draw();
  } else if (mode === 'select') {
    for (let i = rooms.length - 1; i >= 0; i--) {
      const room = rooms[i];
      const hit = room.isPolygon
        ? pointInPolygon(x, y, room.points)
        : (x >= room.x && x <= room.x + room.width && y >= room.y && y <= room.y + room.height);
      if (hit) {
        dragging = true;
        dragRoom = room;
        selectedRoom = room;
        dragOffsetX = x - room.x;
        dragOffsetY = y - room.y;
        updateRoomsList();
        draw();
        return;
      }
    }
  } else if (mode === 'door') {
    addDoorAtPosition(x, y);
  } else if (mode === 'freehand') {
    drawing = true;
    currentPath = {
      points: [{ x, y }],
      color: document.getElementById('penColor').value,
      size: parseInt(document.getElementById('penSize').value)
    };
  } else if (mode === 'erase') {
    eraseFreehandAt(x, y);
  }
});

canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left - panX) / zoom;
  const y = (e.clientY - rect.top - panY) / zoom;
  const ppm = getPxPerMeter();

  if (panMode && dragging) {
    panX += e.clientX - lastPanX;
    panY += e.clientY - lastPanY;
    lastPanX = e.clientX;
    lastPanY = e.clientY;
    draw();
    return;
  }

  if (mode === 'draw' && drawing) {
    // Live dimension display for rectangle drawing
    const widthPx = Math.abs(x - startX);
    const heightPx = Math.abs(y - startY);
    const widthM = (widthPx / ppm).toFixed(2);
    const heightM = (heightPx / ppm).toFixed(2);
    const areaM2 = (widthM * heightM).toFixed(2);
    
    showDimension(`${widthM}m × ${heightM}m  (${areaM2}m²)`, e.clientX, e.clientY);
    draw();
    
    // Draw preview rectangle
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 2 / zoom;
    ctx.setLineDash([5 / zoom, 5 / zoom]);
    ctx.strokeRect(
      Math.min(startX, x),
      Math.min(startY, y),
      widthPx,
      heightPx
    );
    ctx.setLineDash([]);
    
    // Draw dimension lines on preview
    drawPreviewDimensions(ctx, startX, startY, x, y, ppm);
    ctx.restore();
    
  } else if (mode === 'polygon' && polygonPoints.length > 0) {
    // Live dimension for polygon
    const last = polygonPoints[polygonPoints.length - 1];
    const segmentPx = Math.hypot(x - last.x, y - last.y);
    const segmentM = (segmentPx / ppm).toFixed(2);
    
    let perimeterPx = 0;
    for (let i = 0; i < polygonPoints.length - 1; i++) {
      perimeterPx += Math.hypot(
        polygonPoints[i + 1].x - polygonPoints[i].x,
        polygonPoints[i + 1].y - polygonPoints[i].y
      );
    }
    perimeterPx += segmentPx;
    const perimeterM = (perimeterPx / ppm).toFixed(2);
    
    showDimension(`Edge: ${segmentM}m  |  Total: ${perimeterM}m  |  ${polygonPoints.length} pts`, e.clientX, e.clientY);
    
    if (polygonPoints.length >= 3) {
      const first = polygonPoints[0];
      polygonSnapping = Math.hypot(x - first.x, y - first.y) < 15 / zoom;
    }
    draw();
    
    // Draw preview line to cursor
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);
    ctx.strokeStyle = polygonSnapping ? '#22c55e' : '#22d3ee';
    ctx.lineWidth = 2 / zoom;
    ctx.setLineDash([5 / zoom, 5 / zoom]);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(polygonSnapping ? polygonPoints[0].x : x, polygonSnapping ? polygonPoints[0].y : y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    
  } else if (mode === 'select' && dragging && dragRoom) {
    const dx = x - dragOffsetX - dragRoom.x;
    const dy = y - dragOffsetY - dragRoom.y;
    
    if (dragRoom.isPolygon) {
      dragRoom.points.forEach(p => { p.x += dx; p.y += dy; });
      const bb = polygonBBox(dragRoom.points);
      dragRoom.x = bb.x;
      dragRoom.y = bb.y;
    } else {
      dragRoom.x = x - dragOffsetX;
      dragRoom.y = y - dragOffsetY;
    }
    
    // Show position while dragging
    const posX = (dragRoom.x / ppm).toFixed(2);
    const posY = (dragRoom.y / ppm).toFixed(2);
    showDimension(`Position: ${posX}m, ${posY}m`, e.clientX, e.clientY);
    
    draw();
  } else if (mode === 'freehand' && drawing && currentPath) {
    currentPath.points.push({ x, y });
    draw();
    
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);
    ctx.strokeStyle = currentPath.color;
    ctx.lineWidth = currentPath.size / zoom;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    const pts = currentPath.points;
    if (pts.length > 0) {
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
    }
    ctx.stroke();
    ctx.restore();
  } else {
    hideDimension();
  }
});

canvas.addEventListener('mouseup', (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left - panX) / zoom;
  const y = (e.clientY - rect.top - panY) / zoom;

  hideDimension();

  if (panMode && dragging) {
    dragging = false;
    return;
  }

  if (mode === 'draw' && drawing) {
    drawing = false;
    const w = Math.abs(x - startX);
    const h = Math.abs(y - startY);
    
    if (w > 10 && h > 10) {
      const room = {
        id: Date.now(),
        name: `Room ${roomCounter++}`,
        x: Math.min(startX, x),
        y: Math.min(startY, y),
        width: w,
        height: h,
        orientation: 'auto',
        color: getRandomColor(),
        doors: []
      };
      rooms.push(room);
      selectedRoom = room;
      updateRoomsList();
    }
    draw();
  } else if (mode === 'select') {
    dragging = false;
    dragRoom = null;
  } else if (mode === 'freehand' && drawing && currentPath) {
    drawing = false;
    if (currentPath.points.length > 1) {
      currentPath.points = straightenPath(currentPath.points);
      freehandPaths.push(currentPath);
    }
    currentPath = null;
    draw();
  }
});

canvas.addEventListener('dblclick', (e) => {
  if (mode === 'polygon' && polygonPoints.length >= 3) {
    finalisePolygon(polygonPoints.slice());
    hideDimension();
  }
});

// Mouse leave - hide dimension
canvas.addEventListener('mouseleave', () => {
  hideDimension();
});

// ── Mobile tab switching ──────────────────────────────────────────────────────

function switchMobileTab(tab) {
  const sidebar   = document.querySelector('.sidebar');
  const rightPanel = document.querySelector('.right-panel');
  const overlay   = document.getElementById('mobOverlay');
  const tabs      = document.querySelectorAll('.mob-tab');

  sidebar.classList.toggle('mob-open',   tab === 'tools');
  rightPanel.classList.toggle('mob-open', tab === 'rooms');
  overlay.classList.toggle('mob-open', tab === 'tools' || tab === 'rooms');

  tabs.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
}

// ── Toggle pan mode ───────────────────────────────────────────────────────────

function togglePan() {
  panMode = !panMode;
  updateInfo();
  canvas.style.cursor = panMode ? 'grab' : (mode === 'select' ? 'move' : 'crosshair');
}

// ── Initialize ────────────────────────────────────────────────────────────────

updateInfo();
draw();
