(() => {
  const STORAGE_KEY = 'classroom-seat-view-converter-v6';
  const MAX_SIZE = 20;
  const MAX_UNDO_STEPS = 100;
  
  let undoHistory = [], isComposingSeat = false, compositionUndoPending = false;
  let rows = 7, cols = 8, studentView = false, arrangeMode = false;
  let seats = Array.from({ length: rows }, () => Array(cols).fill(''));
  let unassigned = [], arrangeDrag = null, toastTimer = null;
  let pointerDown = null, dragSelecting = false, selectionRange = null;
  let lastFocusedCell = { r: 0, c: 0 };

  const get = id => document.getElementById(id);
  const [table, rowsInput, colsInput, viewTitle, rotateLabel, topStage, bottomStage, seatCount, toast, arrangeBtn, undoBtn, waitingPanel, waitingList, waitingCount, waitingHint, customMenu, menuCopy, menuCut, menuPaste] =
    ['seatTable', 'rowsInput', 'colsInput', 'viewTitle', 'rotateLabel', 'topStage', 'bottomStage', 'seatCount', 'toast', 'arrangeBtn', 'undoBtn', 'waitingPanel', 'waitingList', 'waitingCount', 'waitingHint', 'customMenu', 'menuCopy', 'menuCut', 'menuPaste'].map(get);

  const cleanText = str => String(str ?? '').replace(/[\r\n]/g, ' ').trim();
  const escapeHtml = str => String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[m]);
  const normalizeRange = (a, b) => ({ top: Math.min(a.r, b.r), left: Math.min(a.c, b.c), bottom: Math.max(a.r, b.r), right: Math.max(a.c, b.c) });
  const isInSelection = (r, c) => selectionRange && r >= selectionRange.top && r <= selectionRange.bottom && c >= selectionRange.left && c <= selectionRange.right;
  const selectedAreaSize = () => selectionRange ? (selectionRange.bottom - selectionRange.top + 1) * (selectionRange.right - selectionRange.left + 1) : 1;
  const getStartCoords = () => selectionRange ? { r: selectionRange.top, c: selectionRange.left } : (document.activeElement?.closest?.('.seat') ? { r: Number(document.activeElement.dataset.r), c: Number(document.activeElement.dataset.c) } : lastFocusedCell);

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2000);
  }

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ rows, cols, seats, studentView, unassigned })); } catch (_) {}
  }

  const getSnapshot = () => ({ rows, cols, seats: seats.map(r => [...r]), studentView, unassigned: [...unassigned], lastFocusedCell: { ...lastFocusedCell } });

  function updateUndoButton() {
    undoBtn.disabled = undoHistory.length === 0;
    undoBtn.title = undoBtn.disabled ? '暂无可撤销的操作' : '撤销（Ctrl+Z）';
  }

  function recordUndo() {
    const snapshot = getSnapshot();
    if (JSON.stringify(undoHistory[undoHistory.length - 1]) === JSON.stringify(snapshot)) return;
    undoHistory.push(snapshot);
    if (undoHistory.length > MAX_UNDO_STEPS) undoHistory.shift();
    updateUndoButton();
  }

  function undo() {
    if (undoHistory.length === 0) return showToast('没有可撤销的操作');
    const s = undoHistory.pop();
    [rows, cols, studentView, seats, unassigned] = [s.rows, s.cols, s.studentView, s.seats.map(r => [...r]), [...s.unassigned]];
    lastFocusedCell = { r: Math.max(0, Math.min(rows - 1, s.lastFocusedCell?.r ?? 0)), c: Math.max(0, Math.min(cols - 1, s.lastFocusedCell?.c ?? 0)) };
    selectionRange = pointerDown = dragSelecting = arrangeDrag = null;
    customMenu.classList.remove('show');
    document.body.classList.remove('dragging-seats', 'dragging-arrangement');
    render();
    if (!arrangeMode) focusCell(lastFocusedCell.r, lastFocusedCell.c);
    showToast('已撤销');
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!saved || !Array.isArray(saved.seats)) return;
      rows = Math.max(1, Math.min(MAX_SIZE, Number(saved.rows) || 7));
      cols = Math.max(1, Math.min(MAX_SIZE, Number(saved.cols) || 8));
      seats = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => cleanText(saved.seats?.[r]?.[c])));
      studentView = Boolean(saved.studentView);
      unassigned = Array.isArray(saved.unassigned) ? saved.unassigned.map(cleanText).filter(Boolean) : [];
    } catch (_) {}
  }

  function renderWaitingArea() {
    waitingPanel.hidden = !arrangeMode && unassigned.length === 0;
    waitingCount.textContent = `${unassigned.length} 人`;
    waitingHint.textContent = arrangeMode ? '拖动学生到其他座位可交换位置；拖到空座位可直接安排，也可点右上角 × 暂时移出。' : '学生暂存在这里。点击“调整座位”后，可将学生拖回座位。';
    waitingList.replaceChildren();

    if (unassigned.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'waiting-empty';
      empty.textContent = arrangeMode ? '把学生拖到这里暂时待分配' : '暂无待分配学生';
      waitingList.appendChild(empty);
      return;
    }

    unassigned.forEach((name, index) => {
      const item = document.createElement('div');
      item.className = 'waiting-item';
      item.dataset.index = index;
      item.textContent = name;
      waitingList.appendChild(item);
    });
  }

  function render() {
    rowsInput.value = rows;
    colsInput.value = cols;
    viewTitle.textContent = studentView ? '学生视角' : '教师视角';
    rotateLabel.textContent = studentView ? '恢复视角' : '旋转 180°';
    arrangeBtn.textContent = arrangeMode ? '完成调整' : '调整座位';
    arrangeBtn.setAttribute('aria-pressed', arrangeMode);
    arrangeBtn.classList.toggle('primary', arrangeMode);
    document.body.classList.toggle('arranging-seats', arrangeMode);
    topStage.hidden = !studentView;
    bottomStage.hidden = studentView;
    seatCount.textContent = `${rows} 行 × ${cols} 列 · 共 ${rows * cols} 座位`;

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    headerRow.appendChild(document.createElement('th'));
    for (let c = 0; c < cols; c++) {
      if (c > 0 && c % 2 === 0) {
        const thAis = document.createElement('th');
        thAis.className = 'aisle-col';
        headerRow.appendChild(thAis);
      }
      const th = document.createElement('th');
      th.textContent = `第${studentView ? cols - c : c + 1}列`;
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);

    const tbody = document.createElement('tbody');
    for (let r = 0; r < rows; r++) {
      const tr = document.createElement('tr');
      const rowHead = document.createElement('th');
      rowHead.textContent = `第${studentView ? r + 1 : rows - r}行`;
      tr.appendChild(rowHead);
      for (let c = 0; c < cols; c++) {
        if (c > 0 && c % 2 === 0) {
          const tdAis = document.createElement('td');
          tdAis.className = 'aisle-col';
          tr.appendChild(tdAis);
        }
        const td = document.createElement('td');
        const editor = document.createElement('div');
        editor.className = `seat${seats[r][c] ? ' has-text' : ''}${isInSelection(r, c) ? ' range-selected' : ''}`;
        editor.spellcheck = false;
        editor.dataset.r = r;
        editor.dataset.c = c;

        if (arrangeMode) {
          editor.contentEditable = 'false';
          const label = document.createElement('span');
          label.className = 'seat-label';
          label.textContent = seats[r][c];
          editor.appendChild(label);
          if (seats[r][c]) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'remove-seat';
            btn.textContent = '×';
            btn.title = '移至待分配区';
            editor.appendChild(btn);
          }
        } else {
          editor.contentEditable = 'true';
          editor.textContent = seats[r][c];
        }
        td.appendChild(editor);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.replaceChildren(thead, tbody);
    renderWaitingArea();
    saveState();
    updateUndoButton();
  }

  function resizeGrid(newRows, newCols) {
    const nextRows = Math.max(1, Math.min(MAX_SIZE, Math.floor(newRows || 1)));
    const nextCols = Math.max(1, Math.min(MAX_SIZE, Math.floor(newCols || 1)));
    if (nextRows === rows && nextCols === cols) return render();
    recordUndo();
    selectionRange = null;
    rows = nextRows;
    cols = nextCols;
    seats = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => seats[r]?.[c] ?? ''));
    render();
  }

  function focusCell(r, c, preserveRange = false) {
    if (r < 0 || c < 0 || r >= rows || c >= cols) return;
    if (!preserveRange && selectionRange) { selectionRange = null; paintSelection(); }
    const next = table.querySelector(`.seat[data-r="${r}"][data-c="${c}"]`);
    if (next) {
      next.focus();
      const range = document.createRange();
      range.selectNodeContents(next);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  function pasteMatrix(startR, startC, matrix) {
    if (!matrix.length) return;
    recordUndo();
    const [pRows, pCols] = [matrix.length, Math.max(1, ...matrix.map(l => l.length))];
    const targetRows = Math.min(MAX_SIZE, Math.max(rows, startR + pRows));
    const targetCols = Math.min(MAX_SIZE, Math.max(cols, startC + pCols));

    if (targetRows !== rows || targetCols !== cols) {
      seats = Array.from({ length: targetRows }, (_, r) => Array.from({ length: targetCols }, (_, c) => seats[r]?.[c] ?? ''));
      rows = targetRows; cols = targetCols;
    }

    matrix.forEach((line, r) => line.forEach((val, c) => {
      if (startR + r < rows && startC + c < cols) seats[startR + r][startC + c] = cleanText(val);
    }));

    selectionRange = null;
    render();
    focusCell(Math.min(rows - 1, startR + pRows - 1), Math.min(cols - 1, startC + pCols - 1));
    showToast(`已粘贴 ${pRows} 行 × ${pCols} 列`);
  }

  function paintSelection() {
    table.querySelectorAll('.seat').forEach(cell => {
      cell.classList.toggle('range-selected', isInSelection(Number(cell.dataset.r), Number(cell.dataset.c)));
    });
  }

  const getSelectedTextContent = () => {
    if (!selectionRange) {
      const active = document.activeElement?.closest?.('.seat');
      return active ? (seats[Number(active.dataset.r)]?.[Number(active.dataset.c)] ?? '') : '';
    }
    return Array.from({ length: selectionRange.bottom - selectionRange.top + 1 }, (_, i) => {
      const r = selectionRange.top + i;
      return Array.from({ length: selectionRange.right - selectionRange.left + 1 }, (_, j) => seats[r]?.[selectionRange.left + j] ?? '').join('\t');
    }).join('\n');
  };

  const getSelectedHtmlContent = () => {
    const range = selectionRange || { top: lastFocusedCell.r, bottom: lastFocusedCell.r, left: lastFocusedCell.c, right: lastFocusedCell.c };
    let html = '<table><tbody>';
    for (let r = range.top; r <= range.bottom; r++) {
      html += '<tr>';
      for (let c = range.left; c <= range.right; c++) html += `<td>${escapeHtml(seats[r]?.[c] ?? '')}</td>`;
      html += '</tr>';
    }
    return html + '</tbody></table>';
  };

  // 事件监听绑定
  table.addEventListener('focusin', e => {
    const editor = e.target.closest('.seat');
    if (editor) lastFocusedCell = { r: Number(editor.dataset.r), c: Number(editor.dataset.c) };
  });

  table.addEventListener('compositionstart', e => {
    if (!arrangeMode && e.target.closest('.seat')) { isComposingSeat = true; compositionUndoPending = true; recordUndo(); }
  });
  table.addEventListener('compositionend', () => isComposingSeat = false);
  
  table.addEventListener('beforeinput', e => {
    if (arrangeMode || isComposingSeat || e.isComposing || e.inputType === 'historyUndo' || e.inputType === 'historyRedo' || compositionUndoPending) return;
    if (e.target.closest('.seat')) recordUndo();
  }, true);

  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault(); e.stopPropagation(); undo();
    }
  }, true);

  undoBtn.addEventListener('click', undo);

  table.addEventListener('input', e => {
    if (arrangeMode) return;
    const editor = e.target.closest('.seat');
    if (!editor) return;
    const [r, c] = [Number(editor.dataset.r), Number(editor.dataset.c)];
    seats[r][c] = cleanText(editor.textContent);
    if (compositionUndoPending && !isComposingSeat) compositionUndoPending = false;
    editor.classList.toggle('has-text', Boolean(seats[r][c]));
    lastFocusedCell = { r, c };
    if (selectionRange) { selectionRange = null; paintSelection(); }
    saveState();
  });

  rowsInput.addEventListener('change', () => resizeGrid(rowsInput.value, cols));
  colsInput.addEventListener('change', () => resizeGrid(rows, colsInput.value));

  document.addEventListener('paste', e => {
    if (arrangeMode) return;
    const active = document.activeElement?.closest?.('.seat');
    const clipboard = e.clipboardData;
    if ((!active && !selectionRange) || !clipboard) return;
    e.preventDefault(); e.stopImmediatePropagation();

    let matrix = [];
    const htmlText = clipboard.getData('text/html');
    if (htmlText?.includes('<table')) {
      try {
        new DOMParser().parseFromString(htmlText, 'text/html').querySelectorAll('tr').forEach(tr => {
          const rowData = Array.from(tr.querySelectorAll('td, th'), c => c.textContent.trim());
          if (rowData.length) matrix.push(rowData);
        });
      } catch (_) {}
    }

    if (!matrix.length) {
      const text = clipboard.getData('text/plain');
      if (text) {
        const lines = text.replace(/\r\n?/g, '\n').split('\n');
        if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
        matrix = lines.map(l => l.split('\t').map(x => x.trim()));
      }
    }
    if (!matrix.length) return;

    const { r: startR, c: startC } = getStartCoords();
    if (selectionRange && selectedAreaSize() > 1 && matrix.length === 1 && matrix[0].length === 1) {
      const val = matrix[0][0], range = { ...selectionRange };
      recordUndo();
      let count = 0;
      for (let r = range.top; r <= range.bottom; r++) {
        for (let c = range.left; c <= range.right; c++) {
          if (r < rows && c < cols) { seats[r][c] = val; count++; }
        }
      }
      selectionRange = null;
      render();
      focusCell(range.top, range.left);
      return showToast(`已向 ${count} 个座位填入`);
    }
    pasteMatrix(startR, startC, matrix);
  }, true);

  document.addEventListener('copy', e => {
    if (arrangeMode) return;
    const active = document.activeElement?.closest?.('.seat');
    if (!selectionRange && (!active || !window.getSelection().toString())) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', getSelectedTextContent());
    e.clipboardData.setData('text/html', getSelectedHtmlContent());
    showToast('已复制所选座位');
  });

  document.addEventListener('cut', e => {
    if (arrangeMode) return;
    const active = document.activeElement?.closest?.('.seat');
    if (!selectionRange && (!active || !window.getSelection().toString())) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', getSelectedTextContent());
    const range = selectionRange || { top: Number(active.dataset.r), bottom: Number(active.dataset.r), left: Number(active.dataset.c), right: Number(active.dataset.c) };
    recordUndo();
    for (let r = range.top; r <= range.bottom; r++) for (let c = range.left; c <= range.right; c++) seats[r][c] = '';
    selectionRange = null;
    render();
    focusCell(range.top, range.left);
    showToast('已剪切所选座位');
  });

  table.addEventListener('mousedown', e => {
    if (arrangeMode) return;
    const editor = e.target.closest('.seat');
    if (!editor || e.button !== 0) return;
    pointerDown = { r: Number(editor.dataset.r), c: Number(editor.dataset.c), x: e.clientX, y: e.clientY };
    lastFocusedCell = { r: pointerDown.r, c: pointerDown.c };
    dragSelecting = false;
  });

  document.addEventListener('mousemove', e => {
    if (arrangeMode || !pointerDown || !(e.buttons & 1)) return;
    if (!dragSelecting && Math.hypot(e.clientX - pointerDown.x, e.clientY - pointerDown.y) < 4) return;
    dragSelecting = true;
    document.body.classList.add('dragging-seats');
    e.preventDefault();
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.seat');
    if (!target || !table.contains(target)) return;
    window.getSelection()?.removeAllRanges();
    selectionRange = normalizeRange(pointerDown, { r: Number(target.dataset.r), c: Number(target.dataset.c) });
    paintSelection();
  });

  document.addEventListener('mouseup', () => {
    if (arrangeMode || !pointerDown) return;
    document.body.classList.remove('dragging-seats');
    if (!dragSelecting) { selectionRange = null; paintSelection(); }
    pointerDown = null; dragSelecting = false;
  });

  table.addEventListener('keydown', e => {
    if (arrangeMode) return;
    const editor = e.target.closest('.seat');
    if (!editor) return;
    const [r, c] = [Number(editor.dataset.r), Number(editor.dataset.c)];
    
    if (selectionRange && selectedAreaSize() > 1 && ['Delete', 'Backspace'].includes(e.key)) {
      e.preventDefault();
      recordUndo();
      for (let rr = selectionRange.top; rr <= selectionRange.bottom; rr++) {
        for (let cc = selectionRange.left; cc <= selectionRange.right; cc++) seats[rr][cc] = '';
      }
      const [top, left] = [selectionRange.top, selectionRange.left];
      selectionRange = null;
      render();
      focusCell(top, left);
      return showToast('已清空所选座位');
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault(); focusCell(Math.min(rows - 1, r + 1), c);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const next = Math.max(0, Math.min(rows * cols - 1, e.shiftKey ? (r * cols + c - 1) : (r * cols + c + 1)));
      focusCell(Math.floor(next / cols), next % cols);
    }
  });

  arrangeBtn.addEventListener('click', () => {
    arrangeMode = !arrangeMode;
    selectionRange = pointerDown = dragSelecting = null;
    document.body.classList.remove('dragging-seats', 'dragging-arrangement');
    customMenu.classList.remove('show');
    render();
    showToast(arrangeMode ? '已进入调整模式：拖动学生交换位置，点 × 可移至待分配区' : '已完成座位调整');
  });

  table.addEventListener('click', e => {
    const btn = e.target.closest('.remove-seat');
    if (!btn || !arrangeMode) return;
    e.preventDefault(); e.stopPropagation();
    const editor = btn.closest('.seat');
    if (!editor) return;
    const [r, c] = [Number(editor.dataset.r), Number(editor.dataset.c)];
    const name = seats[r]?.[c] ?? '';
    if (!name) return;
    recordUndo();
    seats[r][c] = '';
    unassigned.push(name);
    selectionRange = null;
    render();
    showToast(`${name} 已移至待分配区`);
  });

  const beginArrangeDrag = (e, source, el) => {
    if (!arrangeMode || !el || (e.button !== undefined && e.button !== 0)) return;
    e.preventDefault();
    arrangeDrag = { source, element: el, startX: e.clientX, startY: e.clientY, started: false, target: null };
  };

  table.addEventListener('pointerdown', e => {
    if (!arrangeMode || e.target.closest('.remove-seat')) return;
    const editor = e.target.closest('.seat');
    if (editor && table.contains(editor) && seats[editor.dataset.r]?.[editor.dataset.c]) {
      beginArrangeDrag(e, { type: 'seat', r: Number(editor.dataset.r), c: Number(editor.dataset.c) }, editor);
    }
  });

  waitingList.addEventListener('pointerdown', e => {
    if (!arrangeMode) return;
    const item = e.target.closest('.waiting-item');
    if (item && waitingList.contains(item)) {
      beginArrangeDrag(e, { type: 'waiting', index: Number(item.dataset.index) }, item);
    }
  });

  function cleanArrangeDrag(commit = false) {
    document.body.classList.remove('dragging-arrangement');
    table.querySelectorAll('.dragging-seat, .drop-target').forEach(el => el.classList.remove('dragging-seat', 'drop-target'));
    waitingList.querySelectorAll('.dragging-seat').forEach(el => el.classList.remove('dragging-seat'));
    waitingPanel.classList.remove('drop-target');

    if (arrangeDrag) {
      const drag = arrangeDrag;
      arrangeDrag = null;
      if (commit && drag.started && drag.target) performArrangeDrop(drag.source, drag.target);
    }
  }

  document.addEventListener('pointermove', e => {
    if (!arrangeDrag || !arrangeMode) return;
    if (!arrangeDrag.started && Math.hypot(e.clientX - arrangeDrag.startX, e.clientY - arrangeDrag.startY) < 6) return;
    if (!arrangeDrag.started) {
      arrangeDrag.started = true;
      document.body.classList.add('dragging-arrangement');
      arrangeDrag.element.classList.add('dragging-seat');
    }
    e.preventDefault();
    
    table.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
    waitingPanel.classList.remove('drop-target');
    arrangeDrag.target = null;

    const under = document.elementFromPoint(e.clientX, e.clientY);
    const targetSeat = under?.closest?.('.seat');
    if (targetSeat && table.contains(targetSeat)) {
      targetSeat.classList.add('drop-target');
      arrangeDrag.target = { type: 'seat', r: Number(targetSeat.dataset.r), c: Number(targetSeat.dataset.c) };
    } else if (arrangeDrag.source.type === 'seat' && under && waitingPanel.contains(under)) {
      waitingPanel.classList.add('drop-target');
      arrangeDrag.target = { type: 'waiting' };
    }
  }, { passive: false });

  document.addEventListener('pointerup', () => cleanArrangeDrag(true));
  document.addEventListener('pointercancel', () => cleanArrangeDrag(false));

  function performArrangeDrop(source, target) {
    selectionRange = null;
    if (source.type === 'seat') {
      const srcName = seats[source.r]?.[source.c] ?? '';
      if (!srcName) return;
      if (target.type === 'waiting') {
        recordUndo();
        seats[source.r][source.c] = '';
        unassigned.push(srcName);
        render();
        return showToast(`${srcName} 已移至待分配区`);
      }
      if (target.type === 'seat' && (source.r !== target.r || source.c !== target.c)) {
        const tgtName = seats[target.r]?.[target.c] ?? '';
        recordUndo();
        [seats[source.r][source.c], seats[target.r][target.c]] = [tgtName, srcName];
        render();
        return showToast(tgtName ? '已交换两名学生的座位' : '已移动到空座位');
      }
    }

    if (source.type === 'waiting' && target.type === 'seat') {
      const srcName = unassigned[source.index];
      if (srcName === undefined) return;
      const displaced = seats[target.r]?.[target.c] ?? '';
      recordUndo();
      seats[target.r][target.c] = srcName;
      unassigned.splice(source.index, 1);
      if (displaced) unassigned.push(displaced);
      render();
      showToast(displaced ? '已安排学生，原座位学生移至待分配区' : '已安排学生到座位');
    }
  }

  get('rotateBtn').addEventListener('click', () => {
    recordUndo();
    seats.reverse().forEach(row => row.reverse());
    selectionRange = null;
    studentView = !studentView;
    render();
  });

  table.addEventListener('contextmenu', e => {
    if (arrangeMode) return e.preventDefault();
    const editor = e.target.closest('.seat');
    if (!editor) return;
    e.preventDefault();
    const [r, c] = [Number(editor.dataset.r), Number(editor.dataset.c)];
    if (!isInSelection(r, c)) { selectionRange = null; paintSelection(); focusCell(r, c); }
    customMenu.style.top = `${Math.min(e.clientY, window.innerHeight - 150)}px`;
    customMenu.style.left = `${Math.min(e.clientX, window.innerWidth - 150)}px`;
    customMenu.classList.add('show');
  });

  document.addEventListener('click', () => customMenu.classList.remove('show'));

  menuCopy.addEventListener('click', async () => {
    customMenu.classList.remove('show');
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([getSelectedTextContent()], { type: 'text/plain' }), 'text/html': new Blob([getSelectedHtmlContent()], { type: 'text/html' }) })]);
    } catch (_) {
      await navigator.clipboard.writeText(getSelectedTextContent());
    }
    showToast('已复制所选座位');
  });

  menuCut.addEventListener('click', async () => {
    customMenu.classList.remove('show');
    try { await navigator.clipboard.writeText(getSelectedTextContent()); } catch (_) {}
    const range = selectionRange || { top: lastFocusedCell.r, bottom: lastFocusedCell.r, left: lastFocusedCell.c, right: lastFocusedCell.c };
    recordUndo();
    for (let r = range.top; r <= range.bottom; r++) for (let c = range.left; c <= range.right; c++) seats[r][c] = '';
    selectionRange = null;
    render();
    focusCell(range.top, range.left);
    showToast('已剪切所选座位');
  });

  menuPaste.addEventListener('click', async () => {
    customMenu.classList.remove('show');
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      const lines = text.replace(/\r\n?/g, '\n').split('\n');
      if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
      const matrix = lines.map(l => l.split('\t').map(x => x.trim()));
      const { r: startR, c: startC } = getStartCoords();
      pasteMatrix(startR, startC, matrix);
    } catch (_) { showToast('粘贴失败，请使用 Ctrl+V'); }
  });

  loadState();
  render();
})();