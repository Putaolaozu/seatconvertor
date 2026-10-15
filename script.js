(() => {
  const STORAGE_KEY = 'classroom-seat-view-converter-v6';
  const MAX_SIZE = 20;
  let rows = 7;
  let cols = 8;
  let seats = Array.from({ length: rows }, () => Array(cols).fill(''));
  let unassigned = [];
  let studentView = false;
  let arrangeMode = false;
  let arrangeDrag = null;
  let toastTimer;
  let pointerDown = null;
  let dragSelecting = false;
  let selectionRange = null;
  let lastFocusedCell = { r: 0, c: 0 };

  const table = document.getElementById('seatTable');
  const rowsInput = document.getElementById('rowsInput');
  const colsInput = document.getElementById('colsInput');
  const viewTitle = document.getElementById('viewTitle');
  const rotateLabel = document.getElementById('rotateLabel');
  const topStage = document.getElementById('topStage');
  const bottomStage = document.getElementById('bottomStage');
  const seatCount = document.getElementById('seatCount');
  const toast = document.getElementById('toast');
  const arrangeBtn = document.getElementById('arrangeBtn');
  const waitingPanel = document.getElementById('waitingPanel');
  const waitingList = document.getElementById('waitingList');
  const waitingCount = document.getElementById('waitingCount');
  const waitingHint = document.getElementById('waitingHint');

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2000);
  }

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ rows, cols, seats, studentView, unassigned })); }
    catch (_) { }
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!saved || !Array.isArray(saved.seats)) return;
      rows = Math.max(1, Math.min(MAX_SIZE, Number(saved.rows) || 7));
      cols = Math.max(1, Math.min(MAX_SIZE, Number(saved.cols) || 8));
      seats = Array.from({ length: rows }, (_, r) => 
        Array.from({ length: cols }, (_, c) => String(saved.seats?.[r]?.[c] ?? '').replace(/[\r\n]/g, ' ').trim())
      );
      studentView = Boolean(saved.studentView);
      unassigned = Array.isArray(saved.unassigned)
        ? saved.unassigned.map(name => String(name ?? '').replace(/[\r\n]/g, ' ').trim()).filter(Boolean)
        : [];
    } catch (_) { }
  }

  function render() {
    rowsInput.value = rows;
    colsInput.value = cols;
    viewTitle.textContent = studentView ? '学生视角' : '教师视角';
    rotateLabel.textContent = studentView ? '恢复视角' : '旋转 180°';
    arrangeBtn.textContent = arrangeMode ? '完成调整' : '调整座位';
    arrangeBtn.setAttribute('aria-pressed', String(arrangeMode));
    arrangeBtn.classList.toggle('primary', arrangeMode);
    document.body.classList.toggle('arranging-seats', arrangeMode);
    topStage.hidden = !studentView;
    bottomStage.hidden = studentView;
    seatCount.textContent = `${rows} 行 × ${cols} 列 · 共 ${rows * cols} 座位`;

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    const corner = document.createElement('th');
    corner.textContent = '';
    headerRow.appendChild(corner);
    for (let c = 0; c < cols; c++) {
      // 每两列之后自动插入一个专用的过道列表头
      if (c > 0 && c % 2 === 0) {
        const aisleTh = document.createElement('th');
        aisleTh.className = 'aisle-col';
        headerRow.appendChild(aisleTh);
      }
      const th = document.createElement('th');
      const colNum = studentView ? cols - c : c + 1;
      th.textContent = `第${colNum}列`;
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);

    const tbody = document.createElement('tbody');
    for (let r = 0; r < rows; r++) {
      const tr = document.createElement('tr');
      const rowHead = document.createElement('th');
      const rowNum = studentView ? r + 1 : rows - r;
      rowHead.textContent = `第${rowNum}行`;
      tr.appendChild(rowHead);
      for (let c = 0; c < cols; c++) {
        // 每两列之后自动插入一个专用的过道列单元格
        if (c > 0 && c % 2 === 0) {
          const aisleTd = document.createElement('td');
          aisleTd.className = 'aisle-col';
          tr.appendChild(aisleTd);
        }
        const td = document.createElement('td');
        const editor = document.createElement('div');
        editor.className = 'seat' + (seats[r][c] ? ' has-text' : '') + (isInSelection(r, c) ? ' range-selected' : '');
        editor.spellcheck = false;
        editor.dataset.r = String(r);
        editor.dataset.c = String(c);
        if (arrangeMode) {
          editor.contentEditable = 'false';
          const label = document.createElement('span');
          label.className = 'seat-label';
          label.textContent = seats[r][c];
          editor.appendChild(label);
          if (seats[r][c]) {
            const removeButton = document.createElement('button');
            removeButton.type = 'button';
            removeButton.className = 'remove-seat';
            removeButton.textContent = '×';
            removeButton.title = '移至待分配区';
            removeButton.setAttribute('aria-label', `将${seats[r][c]}移至待分配区`);
            editor.appendChild(removeButton);
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
  }

  function renderWaitingArea() {
    waitingPanel.hidden = !arrangeMode && unassigned.length === 0;
    waitingCount.textContent = `${unassigned.length} 人`;
    waitingHint.textContent = arrangeMode
      ? '拖动学生到其他座位可交换位置；拖到空座位可直接安排，也可点右上角 × 暂时移出。'
      : '学生暂存在这里。点击“调整座位”后，可将学生拖回座位。';
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
      item.dataset.index = String(index);
      item.textContent = name;
      item.setAttribute('aria-label', arrangeMode ? `拖动学生${name}安排座位` : name);
      waitingList.appendChild(item);
    });
  }

  function isInSelection(r, c) {
    if (!selectionRange) return false;
    return r >= selectionRange.top && r <= selectionRange.bottom && c >= selectionRange.left && c <= selectionRange.right;
  }

  function normalizeRange(a, b) {
    return {
      top: Math.min(a.r, b.r),
      left: Math.min(a.c, b.c),
      bottom: Math.max(a.r, b.r),
      right: Math.max(a.c, b.c)
    };
  }

  function paintSelection() {
    table.querySelectorAll('.seat').forEach(cell => {
      cell.classList.toggle('range-selected', isInSelection(Number(cell.dataset.r), Number(cell.dataset.c)));
    });
  }

  function selectedAreaSize() {
    if (!selectionRange) return 1;
    return (selectionRange.bottom - selectionRange.top + 1) * (selectionRange.right - selectionRange.left + 1);
  }

  function resizeGrid(newRows, newCols) {
    selectionRange = null;
    rows = Math.max(1, Math.min(MAX_SIZE, Math.floor(Number(newRows) || 1)));
    cols = Math.max(1, Math.min(MAX_SIZE, Math.floor(Number(newCols) || 1)));
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
    const pasteRows = matrix.length;
    const pasteCols = Math.max(1, ...matrix.map(line => line.length));
    const targetRows = Math.min(MAX_SIZE, Math.max(rows, startR + pasteRows));
    const targetCols = Math.min(MAX_SIZE, Math.max(cols, startC + pasteCols));

    if (targetRows !== rows || targetCols !== cols) {
      seats = Array.from({ length: targetRows }, (_, r) => Array.from({ length: targetCols }, (_, c) => seats[r]?.[c] ?? ''));
      rows = targetRows;
      cols = targetCols;
    }

    matrix.forEach((line, r) => {
      line.forEach((value, c) => {
        const rr = startR + r;
        const cc = startC + c;
        if (rr < rows && cc < cols) {
          seats[rr][cc] = String(value || '').replace(/[\r\n]/g, ' ').trim();
        }
      });
    });

    selectionRange = null;
    render();
    focusCell(Math.min(rows - 1, startR + pasteRows - 1), Math.min(cols - 1, startC + pasteCols - 1));
    showToast(`已粘贴 ${pasteRows} 行 × ${pasteCols} 列`);
  }

  table.addEventListener('focusin', event => {
    const editor = event.target.closest('.seat');
    if (editor) lastFocusedCell = { r: Number(editor.dataset.r), c: Number(editor.dataset.c) };
  });

  table.addEventListener('input', event => {
    if (arrangeMode) return;
    const editor = event.target.closest('.seat');
    if (!editor) return;
    const r = Number(editor.dataset.r), c = Number(editor.dataset.c);
    seats[r][c] = editor.textContent.replace(/[\r\n]/g, ' ').trim();
    editor.classList.toggle('has-text', Boolean(seats[r][c]));
    lastFocusedCell = { r, c };
    if (selectionRange) { selectionRange = null; paintSelection(); }
    saveState();
  });

  rowsInput.addEventListener('change', () => resizeGrid(rowsInput.value, cols));
  colsInput.addEventListener('change', () => resizeGrid(rows, colsInput.value));

  document.addEventListener('paste', event => {
    if (arrangeMode) return;
    const active = document.activeElement?.closest?.('.seat');
    if (!active && !selectionRange) return;
    const clipboard = event.clipboardData;
    if (!clipboard) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    let matrix = [];
    const htmlText = clipboard.getData('text/html');
    if (htmlText && htmlText.includes('<table')) {
      try {
        const doc = new DOMParser().parseFromString(htmlText, 'text/html');
        doc.querySelectorAll('tr').forEach(tr => {
          const rowData = [];
          tr.querySelectorAll('td, th').forEach(cell => rowData.push(cell.textContent.trim()));
          if (rowData.length > 0) matrix.push(rowData);
        });
      } catch (_) {}
    }

    if (matrix.length === 0) {
      const text = clipboard.getData('text/plain');
      if (text) {
        const lines = text.replace(/\r\n?/g, '\n').split('\n');
        if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
        matrix = lines.map(line => line.split('\t').map(x => x.trim()));
      }
    }

    if (matrix.length === 0) return;

    const startR = selectionRange ? selectionRange.top : (active ? Number(active.dataset.r) : lastFocusedCell.r);
    const startC = selectionRange ? selectionRange.left : (active ? Number(active.dataset.c) : lastFocusedCell.c);

    if (selectionRange && selectedAreaSize() > 1 && matrix.length === 1 && matrix[0].length === 1) {
      const plainText = matrix[0][0];
      const range = { ...selectionRange };
      let count = 0;
      for (let r = range.top; r <= range.bottom; r++) {
        for (let c = range.left; c <= range.right; c++) {
          if (r < rows && c < cols) { seats[r][c] = plainText; count++; }
        }
      }
      selectionRange = null;
      render();
      focusCell(range.top, range.left);
      showToast(`已向 ${count} 个座位填入`);
      return;
    }

    pasteMatrix(startR, startC, matrix);
  }, true);

  // 监听复制事件 (Ctrl + C)
  document.addEventListener('copy', event => {
    if (arrangeMode) return;
    const active = document.activeElement?.closest?.('.seat');
    
    // 如果没有选中区域，且当前焦点不在座位内，或者在座位内选中了部分文字进行原生复制，则不干涉
    if (!selectionRange && active && window.getSelection().toString() !== '') {
      return; 
    }

    if (!selectionRange && !active) return;

    event.preventDefault();
    event.clipboardData.setData('text/plain', getSelectedTextContent());
    showToast('已复制所选座位');
  });

  // 监听剪切事件 (Ctrl + X)
  document.addEventListener('cut', event => {
    if (arrangeMode) return;
    const active = document.activeElement?.closest?.('.seat');
    if (!selectionRange && active && window.getSelection().toString() !== '') {
      return;
    }

    if (!selectionRange && !active) return;

    event.preventDefault();
    
    // 1. 复制文本到剪贴板
    const text = getSelectedTextContent();
    event.clipboardData.setData('text/plain', text);

    // 2. 清空所选区域的座位内容
    if (selectionRange) {
      const range = { ...selectionRange };
      for (let rr = range.top; rr <= range.bottom; rr++) {
        for (let cc = range.left; cc <= range.right; cc++) {
          seats[rr][cc] = '';
        }
      }
      selectionRange = null;
      render();
      focusCell(range.top, range.left);
      showToast('已剪切所选座位');
    } else if (active) {
      const r = Number(active.dataset.r);
      const c = Number(active.dataset.c);
      seats[r][c] = '';
      render();
      focusCell(r, c);
      showToast('已剪切该座位');
    }
  });

  // 辅助函数：获取当前选区或当前聚焦格子的文本内容（行列矩阵格式）
  function getSelectedTextContent() {
    if (selectionRange) {
      const rowsData = [];
      for (let r = selectionRange.top; r <= selectionRange.bottom; r++) {
        const rowData = [];
        for (let c = selectionRange.left; c <= selectionRange.right; c++) {
          rowData.push(seats[r]?.[c] ?? '');
        }
        rowsData.push(rowData.join('\t'));
      }
      return rowsData.join('\n');
    } else {
      const active = document.activeElement?.closest?.('.seat');
      if (active) {
        const r = Number(active.dataset.r);
        const c = Number(active.dataset.c);
        return seats[r]?.[c] ?? '';
      }
    }
    return '';
  }

  table.addEventListener('mousedown', event => {
    if (arrangeMode) return;
    const editor = event.target.closest('.seat');
    if (!editor || event.button !== 0) return;
    pointerDown = { r: Number(editor.dataset.r), c: Number(editor.dataset.c), x: event.clientX, y: event.clientY };
    lastFocusedCell = { r: pointerDown.r, c: pointerDown.c };
    dragSelecting = false;
  });

  document.addEventListener('mousemove', event => {
    if (arrangeMode) return;
    if (!pointerDown || !(event.buttons & 1)) return;
    if (!dragSelecting && Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) < 4) return;
    dragSelecting = true;
    document.body.classList.add('dragging-seats');
    event.preventDefault();
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.seat');
    if (!target || !table.contains(target)) return;
    window.getSelection()?.removeAllRanges();
    selectionRange = normalizeRange(pointerDown, { r: Number(target.dataset.r), c: Number(target.dataset.c) });
    paintSelection();
  });

  document.addEventListener('mouseup', () => {
    if (arrangeMode) return;
    if (!pointerDown) return;
    document.body.classList.remove('dragging-seats');
    if (!dragSelecting) { selectionRange = null; paintSelection(); }
    pointerDown = null;
    dragSelecting = false;
  });

  table.addEventListener('keydown', event => {
    if (arrangeMode) return;
    const editor = event.target.closest('.seat');
    if (!editor) return;
    const r = Number(editor.dataset.r), c = Number(editor.dataset.c);
    if (selectionRange && selectedAreaSize() > 1 && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault();
      const range = { ...selectionRange };
      for (let rr = range.top; rr <= range.bottom; rr++) {
        for (let cc = range.left; cc <= range.right; cc++) seats[rr][cc] = '';
      }
      selectionRange = null;
      render();
      focusCell(range.top, range.left);
      showToast('已清空所选座位');
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      focusCell(Math.min(rows - 1, r + 1), c);
    } else if (event.key === 'Tab') {
      event.preventDefault();
      const next = event.shiftKey ? (r * cols + c - 1) : (r * cols + c + 1);
      const bounded = Math.max(0, Math.min(rows * cols - 1, next));
      focusCell(Math.floor(bounded / cols), bounded % cols);
    }
  });

  arrangeBtn.addEventListener('click', () => {
    arrangeMode = !arrangeMode;
    selectionRange = null;
    pointerDown = null;
    dragSelecting = false;
    document.body.classList.remove('dragging-seats');
    document.body.classList.remove('dragging-arrangement');
    customMenu.classList.remove('show');
    render();
    showToast(arrangeMode
      ? '已进入调整模式：拖动学生交换位置，点 × 可移至待分配区'
      : '已完成座位调整');
  });

  // 叉号：将学生暂时放入待分配区
  table.addEventListener('click', event => {
    const removeButton = event.target.closest('.remove-seat');
    if (!removeButton || !arrangeMode) return;
    event.preventDefault();
    event.stopPropagation();
    const editor = removeButton.closest('.seat');
    if (!editor) return;
    const r = Number(editor.dataset.r);
    const c = Number(editor.dataset.c);
    const name = seats[r]?.[c] ?? '';
    if (!name) return;
    seats[r][c] = '';
    unassigned.push(name);
    selectionRange = null;
    render();
    showToast(`${name} 已移至待分配区`);
  });

  function beginArrangeDrag(event, source, element) {
    if (!arrangeMode || !element) return;
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    arrangeDrag = {
      source,
      element,
      startX: event.clientX,
      startY: event.clientY,
      started: false,
      target: null
    };
  }

  table.addEventListener('pointerdown', event => {
    if (!arrangeMode || event.target.closest('.remove-seat')) return;
    const editor = event.target.closest('.seat');
    if (!editor || !table.contains(editor)) return;
    const r = Number(editor.dataset.r);
    const c = Number(editor.dataset.c);
    if (!seats[r]?.[c]) return;
    beginArrangeDrag(event, { type: 'seat', r, c }, editor);
  });

  waitingList.addEventListener('pointerdown', event => {
    if (!arrangeMode) return;
    const item = event.target.closest('.waiting-item');
    if (!item || !waitingList.contains(item)) return;
    beginArrangeDrag(event, { type: 'waiting', index: Number(item.dataset.index) }, item);
  });

  function clearArrangeDropTarget() {
    table.querySelectorAll('.drop-target').forEach(element => element.classList.remove('drop-target'));
    waitingPanel.classList.remove('drop-target');
    if (arrangeDrag) arrangeDrag.target = null;
  }

  function cleanArrangeDrag() {
    document.body.classList.remove('dragging-arrangement');
    table.querySelectorAll('.dragging-seat, .drop-target').forEach(element => {
      element.classList.remove('dragging-seat', 'drop-target');
    });
    waitingList.querySelectorAll('.dragging-seat').forEach(element => element.classList.remove('dragging-seat'));
    waitingPanel.classList.remove('drop-target');
  }

  document.addEventListener('pointermove', event => {
    if (!arrangeDrag || !arrangeMode) return;
    if (!arrangeDrag.started && Math.hypot(event.clientX - arrangeDrag.startX, event.clientY - arrangeDrag.startY) < 6) return;
    if (!arrangeDrag.started) {
      arrangeDrag.started = true;
      document.body.classList.add('dragging-arrangement');
      arrangeDrag.element.classList.add('dragging-seat');
    }
    event.preventDefault();
    clearArrangeDropTarget();
    const underPointer = document.elementFromPoint(event.clientX, event.clientY);
    const targetSeat = underPointer?.closest?.('.seat');
    if (targetSeat && table.contains(targetSeat)) {
      targetSeat.classList.add('drop-target');
      arrangeDrag.target = {
        type: 'seat',
        r: Number(targetSeat.dataset.r),
        c: Number(targetSeat.dataset.c)
      };
    } else if (arrangeDrag.source.type === 'seat' && underPointer && waitingPanel.contains(underPointer)) {
      waitingPanel.classList.add('drop-target');
      arrangeDrag.target = { type: 'waiting' };
    }
  }, { passive: false });

  function finishArrangeDrag(commit) {
    if (!arrangeDrag) return;
    const drag = arrangeDrag;
    arrangeDrag = null;
    cleanArrangeDrag();
    if (commit && drag.started && drag.target) performArrangeDrop(drag.source, drag.target);
  }

  document.addEventListener('pointerup', () => finishArrangeDrag(true));
  document.addEventListener('pointercancel', () => finishArrangeDrag(false));

  function performArrangeDrop(source, target) {
    selectionRange = null;
    if (source.type === 'seat') {
      const sourceName = seats[source.r]?.[source.c] ?? '';
      if (!sourceName) return;
      if (target.type === 'waiting') {
        seats[source.r][source.c] = '';
        unassigned.push(sourceName);
        render();
        showToast(`${sourceName} 已移至待分配区`);
        return;
      }
      if (target.type === 'seat') {
        if (source.r === target.r && source.c === target.c) return;
        const targetName = seats[target.r]?.[target.c] ?? '';
        seats[source.r][source.c] = targetName;
        seats[target.r][target.c] = sourceName;
        render();
        showToast(targetName ? '已交换两名学生的座位' : '已移动到空座位');
        return;
      }
    }

    if (source.type === 'waiting' && target.type === 'seat') {
      const sourceName = unassigned[source.index];
      if (sourceName === undefined) return;
      const displacedName = seats[target.r]?.[target.c] ?? '';
      seats[target.r][target.c] = sourceName;
      unassigned.splice(source.index, 1);
      if (displacedName) unassigned.push(displacedName);
      render();
      showToast(displacedName ? '已安排学生，原座位学生移至待分配区' : '已安排学生到座位');
    }
  }

  document.getElementById('rotateBtn').addEventListener('click', () => {
    seats.reverse();
    seats.forEach(row => row.reverse());
    selectionRange = null;
    studentView = !studentView;
    render();
  });

// 自定义右键菜单逻辑
  const customMenu = document.getElementById('customMenu');
  const menuCopy = document.getElementById('menuCopy');
  const menuCut = document.getElementById('menuCut');
  const menuPaste = document.getElementById('menuPaste');

  table.addEventListener('contextmenu', event => {
    if (arrangeMode) { event.preventDefault(); return; }
    const editor = event.target.closest('.seat');
    if (!editor) return;

    event.preventDefault(); // 阻止浏览器默认右键菜单
    
    // 如果右键的点不在当前多选区域内，且没有点中已选中的格子，则重置选中单格
    const r = Number(editor.dataset.r);
    const c = Number(editor.dataset.c);
    if (!isInSelection(r, c)) {
      selectionRange = null;
      paintSelection();
      focusCell(r, c);
    }

    // 显示自定义菜单
    customMenu.style.top = `${Math.min(event.clientY, window.innerHeight - 150)}px`;
    customMenu.style.left = `${Math.min(event.clientX, window.innerWidth - 150)}px`;
    customMenu.classList.add('show');
  });

  // 点击页面其他地方隐藏右键菜单
  document.addEventListener('click', () => {
    customMenu.classList.remove('show');
  });

  // 右键菜单项：复制
  menuCopy.addEventListener('click', async () => {
    customMenu.classList.remove('show');
    const text = getSelectedTextContent();
    try {
      await navigator.clipboard.writeText(text);
      showToast('已复制所选座位');
    } catch (_) {
      showToast('复制失败');
    }
  });

  // 右键菜单项：剪切
  menuCut.addEventListener('click', async () => {
    customMenu.classList.remove('show');
    const text = getSelectedTextContent();
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {}

    if (selectionRange) {
      const range = { ...selectionRange };
      for (let rr = range.top; rr <= range.bottom; rr++) {
        for (let cc = range.left; cc <= range.right; cc++) {
          seats[rr][cc] = '';
        }
      }
      selectionRange = null;
      render();
      focusCell(range.top, range.left);
      showToast('已剪切所选座位');
    } else {
      const active = document.activeElement?.closest?.('.seat');
      if (active) {
        const r = Number(active.dataset.r);
        const c = Number(active.dataset.c);
        seats[r][c] = '';
        render();
        focusCell(r, c);
        showToast('已剪切该座位');
      }
    }
  });

  // 右键菜单项：粘贴
  menuPaste.addEventListener('click', async () => {
    customMenu.classList.remove('show');
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      const lines = text.replace(/\r\n?/g, '\n').split('\n');
      if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
      const matrix = lines.map(line => line.split('\t').map(x => x.trim()));
      
      const active = document.activeElement?.closest?.('.seat');
      const startR = selectionRange ? selectionRange.top : (active ? Number(active.dataset.r) : lastFocusedCell.r);
      const startC = selectionRange ? selectionRange.left : (active ? Number(active.dataset.c) : lastFocusedCell.c);
      
      pasteMatrix(startR, startC, matrix);
    } catch (err) {
      showToast('粘贴失败，请使用 Ctrl+V');
    }
  });

  loadState();
  render();
})();