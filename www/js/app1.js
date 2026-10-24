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
let polygonPoints = [];   // world-space points placed so far
let polygonSnapping = false; // true when cursor is near first point (close hint)

// Set drawing mode
function setMode(m) {
  mode = m;
  document.getElementById('btnDraw').classList.remove('active');
  document.getElementById('btnSelect').classList.remove('active');
  document.getElementById('btnDoor').classList.remove('active');
  document.getElementById('btnFreehand').classList.remove('active');
  document.getElementById('btnErase').classList.remove('active');
  if (document.getElementById('btnPolygon')) document.getElementById('btnPolygon').classList.remove('active');

  // Cancel any in-progress polygon when switching away
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

// Room management
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
        ${room.isPolygon
          ? `📐 <span style="color:#ecf0f1;font-size:0.85em;">Area: ${areaM2} m² &nbsp;(BBox: ${lengthM}×${widthM} m)</span>`
          : `📏
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
  
  // Restore original rooms
  room.originalRoomData.forEach(origRoom => {
    rooms.push(origRoom);
  });
  
  // Remove combined room
  rooms = rooms.filter(r => r.id !== roomId);
  
  selectedRoom = null;
  updateRoomsList();
  draw();
  
  alert('Room split back into original rooms!');
}

function addRoomByDimension() {
  // Pre-fill name with next room counter
  document.getElementById('armName').value   = `Room ${roomCounter}`;
  document.getElementById('armLength').value = '';
  document.getElementById('armWidth').value  = '';
  document.getElementById('armError').style.display = 'none';

  const modal = document.getElementById('addRoomModal');
  modal.style.display = 'flex';

  // Focus the name field, select all so user can type immediately
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

  // Place new room to the right of the last room, wrapping if needed
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
    // Auto-refresh results if they are already showing
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

// Edit door functions
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

// Door functions
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

// Freehand functions
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

// Line straightening algorithm
function straightenPath(points) {
  if (points.length < 2) return points;

  const threshold = 15; // degrees from horizontal/vertical
  const straightened = [points[0]];

  for (let i = 1; i < points.length; i++) {
    const prev = straightened[straightened.length - 1];
    const curr = points[i];

    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;

    // Check if nearly horizontal
    if (Math.abs(angle) < threshold || Math.abs(angle - 180) < threshold || Math.abs(angle + 180) < threshold) {
      straightened.push({x: curr.x, y: prev.y});
    }
    // Check if nearly vertical
    else if (Math.abs(angle - 90) < threshold || Math.abs(angle + 90) < threshold) {
      straightened.push({x: prev.x, y: curr.y});
    }
    // Keep original point
    else {
      straightened.push(curr);
    }
  }

  return straightened;
}


// ── Polygon room helpers ──────────────────────────────────────────────────────

// Signed area via shoelace (negative = CW winding)
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

// Point-in-polygon (ray casting)
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
  // Ensure CCW winding so area is positive
  if (polygonSignedArea(pts) < 0) pts = pts.slice().reverse();
  const bb = polygonBBox(pts);
  const room = {
    id: Date.now(),
    name: `Room ${roomCounter++}`,
    points: pts,           // polygon path in world coords
    isPolygon: true,
    // rect fields derived from bounding box (for carpet calc compat)
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

// Cancel polygon in progress (Escape key)
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && mode === 'polygon' && polygonPoints.length > 0) {
    polygonPoints = [];
    draw();
    updateInfo();
  }
});

// Zoom controls
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
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
    console.log('PDF.js worker configured:', pdfjsLib.GlobalWorkerOptions.workerSrc);
  }
}

// Background image
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
  // If PDF, render first page to canvas using PDF.js then convert to image
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

// Render first page of a PDF file to a PNG Blob using PDF.js
function renderPdfPageToBlob(file) {
  return new Promise((resolve, reject) => {
    try {
      const url = URL.createObjectURL(file);
      const loadingTask = pdfjsLib.getDocument(url);
      loadingTask.promise.then(pdf => {
        return pdf.getPage(1);
      }).then(page => {
        // Choose a scale so the rendered width matches canvas display width
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

function clearBgImage() {
  bgImage = null;
  document.getElementById('bgImageInput').value = '';
  draw();
}

// Auto import rooms from selected background image using OpenCV/Tesseract
async function autoImportRooms() {
  const input = document.getElementById('bgImageInput');
  const file = input.files[0];
  if (!file) { alert('Please select a background image first (Upload Image).'); return; }

  try {
    // show brief progress
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
      // render first page to image blob then pass as File to importer
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

// Initialize
updateInfo();

// ── Mobile tab switching ───────────────────────────────────────────────────────
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
