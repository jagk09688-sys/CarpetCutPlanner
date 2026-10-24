(function(){
  // Floorplan extraction utilities using OpenCV.js and Tesseract.js
  // Exposes: extractFloorplanFromImageElement(imgElement, options)
  //          extractFloorplanFromFile(file, options)

  function waitForOpenCv() {
    return new Promise((resolve, reject) => {
      if (typeof cv !== 'undefined' && cv && cv.Mat) return resolve();
      // if opencv script sets onRuntimeInitialized
      let waited = false;
      const timeout = setTimeout(() => {
        if (!waited) {
          waited = true;
          if (typeof cv !== 'undefined' && cv && cv.Mat) return resolve();
          reject(new Error('OpenCV.js did not load in time'));
        }
      }, 15000);
      if (typeof cv !== 'undefined' && cv && cv['onRuntimeInitialized']) {
        cv['onRuntimeInitialized'] = () => {
          clearTimeout(timeout);
          resolve();
        };
      } else {
        // Poll
        const iv = setInterval(() => {
          if (typeof cv !== 'undefined' && cv && cv.Mat) {
            clearInterval(iv);
            clearTimeout(timeout);
            resolve();
          }
        }, 200);
      }
    });
  }

  async function reportOpenCvStatus() {
    console.log('OpenCV: loading status check...');
    try {
      await waitForOpenCv();
      console.log('OpenCV is ready:', typeof cv !== 'undefined' && cv && !!cv.Mat);
    } catch (err) {
      console.error('OpenCV failed to load:', err);
    }
  }

  if (document.readyState === 'complete') {
    reportOpenCvStatus();
  } else {
    window.addEventListener('load', reportOpenCvStatus);
  }

  async function doOCROnCanvas(canvas) {
    if (typeof Tesseract === 'undefined') return { text: '', words: [] };
    try {
      if (Tesseract.createWorker) {
        const worker = Tesseract.createWorker();
        await worker.load();
        await worker.loadLanguage('eng');
        await worker.initialize('eng');
        const { data } = await worker.recognize(canvas);
        await worker.terminate();
        return { text: data.text, words: (data.words || []).map(w => ({ text: w.text, bbox: { x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 }, confidence: w.confidence })) };
      } else if (Tesseract.recognize) {
        const res = await Tesseract.recognize(canvas, 'eng');
        const data = res.data || {};
        return { text: data.text || '', words: (data.words || []).map(w => ({ text: w.text, bbox: w.bbox, confidence: w.confidence })) };
      }
    } catch (err) {
      console.warn('OCR failed', err);
      return { text: '', words: [] };
    }
    return { text: '', words: [] };
  }

  function median(arr) {
    if (!arr.length) return null;
    const s = arr.slice().sort((a,b)=>a-b);
    const mid = Math.floor(s.length/2);
    return s.length%2===0 ? (s[mid-1]+s[mid])/2 : s[mid];
  }

  async function extractFloorplanFromImageElement(imgElement, options={}){
    await waitForOpenCv();
    // ensure image is loaded
    if (!imgElement.complete) {
      await new Promise(r => imgElement.onload = r);
    }

    const canvas = document.createElement('canvas');
    canvas.width = imgElement.naturalWidth || imgElement.width;
    canvas.height = imgElement.naturalHeight || imgElement.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imgElement, 0, 0, canvas.width, canvas.height);

    const src = cv.imread(canvas);
    const gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
    const blur = new cv.Mat();
    cv.GaussianBlur(gray, blur, new cv.Size(5,5), 0);
    const edges = new cv.Mat();
    cv.Canny(blur, edges, 50, 150);

    // Find contours
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const rooms = [];
    const imgArea = src.rows * src.cols;
    for (let i=0; i<contours.size(); i++){
      const cnt = contours.get(i);
      const area = cv.contourArea(cnt);
      if (area < imgArea * 0.0005) { cnt.delete(); continue; }
      const peri = cv.arcLength(cnt, true);
      const approx = new cv.Mat();
      cv.approxPolyDP(cnt, approx, 0.02 * peri, true);
      // collect polygon points
      const points = [];
      for (let p=0; p<approx.total(); p++){
        const pt = approx.intPtr(p);
        points.push({ x: pt[0], y: pt[1] });
      }
      if (points.length >= 3) {
        rooms.push({ points, area });
      }
      approx.delete();
      cnt.delete();
    }

    // Try Hough lines to detect grid spacing
    const lines = new cv.Mat();
    // HoughLinesP requires a copy of edges in CV_8U
    const edgesCopy = edges.clone();
    cv.cvtColor(edgesCopy, edgesCopy, cv.COLOR_GRAY2RGBA); // noop just to keep type consistent
    try {
      cv.HoughLinesP(edges, lines, 1, Math.PI/180, 80, Math.max(20, src.cols/40), 10);
    } catch (e) {
      // may throw if no lines
    }

    const horiz = [];
    const vert = [];
    for (let i=0; i<lines.rows; i++){
      const x1 = lines.data32S[i*4+0];
      const y1 = lines.data32S[i*4+1];
      const x2 = lines.data32S[i*4+2];
      const y2 = lines.data32S[i*4+3];
      const dx = x2 - x1;
      const dy = y2 - y1;
      if (Math.abs(dy) < Math.abs(dx) * 0.3) {
        // horizontal
        horiz.push((y1+y2)/2);
      } else if (Math.abs(dx) < Math.abs(dy) * 0.3) {
        // vertical
        vert.push((x1+x2)/2);
      }
    }
    let pxPerMeter = options.pxPerMeter || null;
    if (!pxPerMeter) {
      const hdiffs = [];
      horiz.sort((a,b)=>a-b);
      for (let i=1;i<horiz.length;i++) hdiffs.push(Math.abs(horiz[i]-horiz[i-1]));
      const vdiffs = [];
      vert.sort((a,b)=>a-b);
      for (let i=1;i<vert.length;i++) vdiffs.push(Math.abs(vert[i]-vert[i-1]));
      const medH = median(hdiffs);
      const medV = median(vdiffs);
      const spacing = medH || medV || null;
      if (spacing && spacing > 2) {
        // assume grid spacing corresponds to 1 meter (best-effort)
        pxPerMeter = spacing;
      }
    }

    // Run OCR to extract textual dimensions
    const ocr = await doOCROnCanvas(canvas);

    // Clean up mats
    src.delete(); gray.delete(); blur.delete(); edges.delete(); contours.delete(); hierarchy.delete(); edgesCopy.delete(); lines.delete();

    return { rooms, ocr, pxPerMeter, width: canvas.width, height: canvas.height };
  }

  async function extractFloorplanFromFile(file, options={}){
    if (!file) throw new Error('No file provided');
    const img = document.createElement('img');
    const url = URL.createObjectURL(file);
    img.src = url;
    try {
      const result = await extractFloorplanFromImageElement(img, options);
      URL.revokeObjectURL(url);
      return result;
    } catch (err) {
      URL.revokeObjectURL(url);
      throw err;
    }
  }

  // expose
  window.extractFloorplanFromImageElement = extractFloorplanFromImageElement;
  window.extractFloorplanFromFile = extractFloorplanFromFile;
  
  // Import detected rooms into the app's `rooms` array.
  // Options: { assignNames: true, pxPerMeterOverride: number }
  async function importDetectedRooms(file, options={}){
    const res = await extractFloorplanFromFile(file, options);
    // wait until canvas exists
    const canvas = document.getElementById('canvas');
    if (!canvas) throw new Error('Canvas not found');

    // scale detected coordinates from image space -> canvas space
    const sx = canvas.width / res.width;
    const sy = canvas.height / res.height;
    const scale = (sx + sy) / 2;

    // if pppm found, set UI value (scale to canvas)
    if (res.pxPerMeter && !options.pxPerMeterOverride) {
      const canvasPPM = res.pxPerMeter * scale;
      const el = document.getElementById('pxPerMeter');
      if (el) el.value = Math.round(canvasPPM);
    } else if (options.pxPerMeterOverride) {
      document.getElementById('pxPerMeter').value = options.pxPerMeterOverride;
    }

    // Basic OCR numeric parsing: collect numeric tokens (0.5 - 20 metres)
    const numericTokens = (res.ocr.words || []).map(w => {
      const txt = (w.text || '').replace(/[^0-9\.]/g, '').trim();
      const num = parseFloat(txt);
      if (!isFinite(num)) return null;
      if (num < 0.3 || num > 25) return null;
      // convert bbox to canvas space
      const bbox = w.bbox || {};
      const cx = ((bbox.x0 + bbox.x1) / 2) * sx;
      const cy = ((bbox.y0 + bbox.y1) / 2) * sy;
      return { num, cx, cy };
    }).filter(Boolean);

    // Create room rectangles from polygon bounding boxes
    const created = [];
    for (let i=0;i<res.rooms.length;i++){
      const poly = res.rooms[i];
      let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
      for (let p of poly.points){
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
      // scale to canvas
      const x = minX * sx;
      const y = minY * sy;
      const w = (maxX - minX) * sx;
      const h = (maxY - minY) * sy;

      // attempt to associate OCR numbers
      const centerX = x + w/2, centerY = y + h/2;
      const nearbyNums = numericTokens
        .map(t => ({ ...t, dist: Math.hypot(t.cx - centerX, t.cy - centerY) }))
        .filter(t => t.dist < Math.max(w, h) * 0.9)
        .sort((a, b) => a.dist - b.dist);
      const nums = nearbyNums.slice(0, 2).map(n => n.num);

      const ppm = parseFloat(document.getElementById('pxPerMeter').value) || 40;
      let finalW = w, finalH = h;
      let detectedLength = null, detectedWidth = null;
      if (nums.length >= 2) {
        const [n1, n2] = nums;
        const bboxWm = w / ppm;
        const bboxHm = h / ppm;
        const scoreA = Math.abs(n1 - bboxWm) + Math.abs(n2 - bboxHm);
        const scoreB = Math.abs(n1 - bboxHm) + Math.abs(n2 - bboxWm);
        if (scoreA <= scoreB) {
          finalW = n1 * ppm;
          finalH = n2 * ppm;
          detectedLength = n1;
          detectedWidth = n2;
        } else {
          finalW = n2 * ppm;
          finalH = n1 * ppm;
          detectedLength = n2;
          detectedWidth = n1;
        }
        console.log(`[IMPORT ROOM ${i}] OCR nums: [${n1}, ${n2}] bbox: ${bboxWm.toFixed(2)}×${bboxHm.toFixed(2)}m scoreA=${scoreA.toFixed(2)} scoreB=${scoreB.toFixed(2)} → length=${detectedLength} width=${detectedWidth}`);
      } else if (nums.length === 1) {
        // one number — if close to bbox width in metres, set width
        const single = nums[0];
        const bboxWm = w / ppm; const bboxHm = h / ppm;
        if (Math.abs(single - bboxWm) < Math.abs(single - bboxHm)) {
          finalW = single * ppm;
          detectedLength = single;
        } else {
          finalH = single * ppm;
          detectedWidth = single;
        }
        console.log(`[IMPORT ROOM ${i}] Single OCR: ${single}m → length=${detectedLength} width=${detectedWidth}`);
      } else {
        console.log(`[IMPORT ROOM ${i}] No OCR dims found, using bbox: ${(w/ppm).toFixed(2)}×${(h/ppm).toFixed(2)}m`);
      }

      const room = {
        id: Date.now() + i,
        name: options.assignNames ? `Imported ${i+1}` : `Room ${roomCounter++}`,
        x: x,
        y: y,
        width: finalW,
        height: finalH,
        orientation: 'auto',
        color: getRandomColor(),
        doors: [],
        _ocrLength: detectedLength,
        _ocrWidth: detectedWidth,
      };

      // push into global rooms
      if (window.rooms && Array.isArray(window.rooms)) {
        window.rooms.push(room);
        created.push(room);
      }
    }

    // redraw and update list if functions exist
    if (typeof updateRoomsList === 'function') updateRoomsList();
    if (typeof draw === 'function') draw();

    return { created, pxPerMeter: document.getElementById('pxPerMeter').value, ocr: res.ocr };
  }

  window.importDetectedRooms = importDetectedRooms;
})();
