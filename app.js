/* 사무용품 상시 신청 — 정적 웹앱 (설치·빌드·외부 라이브러리 없음)
 * 데이터는 브라우저 localStorage에 저장합니다. 저장 계층은 Store 객체 하나에 모아 두어,
 * 나중에 구글 시트나 서버로 옮길 때 이 부분만 바꾸면 됩니다.
 */
(() => {
  'use strict';

  // ------------------------------------------------------------------ 상수
  const STORAGE_KEY = 'office-supply-request.v1';
  const EDIT_WINDOW_MS = 72 * 60 * 60 * 1000; // 3일
  const DEFAULT_CATEGORIES = ['복사용지', '잉크/토너', '사무용품', '디지털&PC', '식음료/생활/MRO'];
  const S = { // 신청 상태
    APPLIED: '신청', CANCELED: '취소', FIXED: '확정',
    PENDING: '확인 대기', APPROVED: '승인', REJECTED: '반려',
  };
  const ORDER_STATUSES = [S.APPLIED, S.APPROVED, S.FIXED];        // 주문서·합산에 들어가는 상태
  const LIMIT_EXCLUDED = [S.CANCELED, S.REJECTED];                // 한도 계산에서 빼는 상태
  const USER_EDITABLE = [S.APPLIED, S.PENDING];                   // 사원이 수정·취소할 수 있는 상태

  // 샘플 품목: 실제 오피스디포 코드가 아닙니다. 관리자 > 설정에서 교체하세요.
  const SAMPLE_CATALOG = [
    ['S-1001', 'A4 복사용지 80g 500매', '복사용지', 5900, '1권'],
    ['S-1002', 'A4 복사용지 80g 2500매(박스)', '복사용지', 27500, '1박스'],
    ['S-1003', 'A3 복사용지 80g 500매', '복사용지', 11800, '1권'],
    ['S-2001', '레이저 토너 검정(표준)', '잉크/토너', 68000, '1개'],
    ['S-2002', '레이저 토너 컬러 3색 세트', '잉크/토너', 189000, '1세트'],
    ['S-2003', '잉크젯 카트리지 검정', '잉크/토너', 24000, '1개'],
    ['S-3001', '중성 볼펜 0.5mm 검정', '사무용품', 900, '1자루'],
    ['S-3002', '중성 볼펜 0.5mm 파랑', '사무용품', 900, '1자루'],
    ['S-3003', '유성 볼펜 0.7mm 검정 12자루', '사무용품', 4800, '1타'],
    ['S-3004', '형광펜 5색 세트', '사무용품', 3500, '1세트'],
    ['S-3005', '샤프 0.5mm', '사무용품', 2500, '1자루'],
    ['S-3006', '수정테이프 5mm', '사무용품', 1800, '1개'],
    ['S-3007', '포스트잇 76x76mm 노랑', '사무용품', 1500, '1패드'],
    ['S-3008', '스테이플러 중형', '사무용품', 7800, '1개'],
    ['S-3009', '스테이플 침 33호', '사무용품', 600, '1갑'],
    ['S-3010', 'L자 파일 A4 투명 10매', '사무용품', 2900, '1팩'],
    ['S-3011', '2공 D링 바인더 A4 3cm', '사무용품', 4200, '1개'],
    ['S-3012', '스프링 노트 A5', '사무용품', 2200, '1권'],
    ['S-3013', '가위 사무용', '사무용품', 3300, '1개'],
    ['S-3014', '양면테이프 12mm', '사무용품', 1700, '1개'],
    ['S-4001', '무선 마우스', '디지털&PC', 15900, '1개'],
    ['S-4002', 'USB 메모리 64GB', '디지털&PC', 12900, '1개'],
    ['S-4003', 'AA 알카라인 건전지 10입', '디지털&PC', 6900, '1팩'],
    ['S-5001', '종이컵 6.5oz 1000개', '식음료/생활/MRO', 15800, '1박스'],
    ['S-5002', '믹스커피 100T', '식음료/생활/MRO', 13900, '1박스'],
    ['S-5003', '물티슈 100매', '식음료/생활/MRO', 2300, '1개'],
  ];
  const SAMPLE_DEPTS = ['경영지원팀', '기획팀', '영업팀', '마케팅팀', '개발팀', '디자인팀', '인사팀', '재무팀'];

  // ------------------------------------------------------------------ 유틸
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const won = (n) => (n == null || isNaN(n) ? '-' : Number(n).toLocaleString('ko-KR') + '원');
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const pad = (n) => String(n).padStart(2, '0');
  const fmtDate = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const fmtDateTime = (ms) => { const d = new Date(ms); return `${fmtDate(ms)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const norm = (s) => String(s ?? '').trim();
  const statusClass = (st) => 'st-' + st.replace(/\s/g, '');

  function currentQuarterOf(date = new Date()) {
    return `${date.getFullYear()}-Q${Math.floor(date.getMonth() / 3) + 1}`;
  }
  function nextQuarter(q) {
    const m = /^(\d{4})-Q([1-4])$/.exec(q);
    if (!m) return currentQuarterOf();
    let y = Number(m[1]), n = Number(m[2]) + 1;
    if (n > 4) { n = 1; y += 1; }
    return `${y}-Q${n}`;
  }
  function quarterLabel(q) {
    const m = /^(\d{4})-Q([1-4])$/.exec(q);
    return m ? `${m[1]}년 ${m[2]}분기` : q;
  }

  async function hash(text) {
    const salted = 'osr::' + text;
    if (window.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salted));
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    // 보안 컨텍스트가 아닐 때의 대체(약한 해시)
    let h = 2166136261;
    for (const ch of salted) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    return 'f' + (h >>> 0).toString(16);
  }

  function toast(text) {
    const t = $('#toast');
    t.textContent = text; t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, 2600);
  }
  function showMsg(el, text, kind = 'ok') {
    el.className = 'msg ' + kind; el.innerHTML = text; el.hidden = false;
  }

  function download(filename, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // ------------------------------------------------------------------ 저장소 (localStorage)
  const Store = {
    data: null,
    defaults() {
      return {
        version: 1,
        settings: {
          quarter: currentQuarterOf(),
          limit: 50000,
          writer: '기획팀',
          departments: SAMPLE_DEPTS.slice(),
          adminHash: null,
          closedQuarters: [],   // [{ quarter, closedAt }]
        },
        catalog: SAMPLE_CATALOG.map(([code, name, category, price, unit]) => ({ code, name, category, price, unit })),
        catalogIsSample: true,
        requests: [],
      };
    },
    load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        this.data = raw ? JSON.parse(raw) : this.defaults();
      } catch (e) {
        console.warn('저장된 데이터를 읽지 못해 새로 시작합니다.', e);
        this.data = this.defaults();
      }
      return this.normalize();
    },
    normalize() {
      const d = this.defaults();
      this.data.settings = Object.assign(d.settings, this.data.settings || {});
      this.data.catalog = this.data.catalog || [];
      this.data.requests = this.data.requests || [];
      return this.data;
    },
    save() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
        return true;
      } catch (e) {
        alert('브라우저 저장에 실패했습니다. 저장 공간이 부족하거나 브라우저 설정에서 저장이 막혀 있을 수 있어요.');
        return false;
      }
    },
    reset() { this.data = this.defaults(); this.save(); },
    get settings() { return this.data.settings; },
    get catalog() { return this.data.catalog; },
    get requests() { return this.data.requests; },
    isClosed(q) { return this.data.settings.closedQuarters.some((c) => c.quarter === q); },
  };

  // ------------------------------------------------------------------ 계산
  const personKey = (r) => `${norm(r.dept)}|${norm(r.name)}|${r.pinHash}`;
  const amountOf = (r) => (r.unitPrice == null ? null : r.unitPrice * r.qty);

  function personTotal(key, quarter, excludeId) {
    return Store.requests
      .filter((r) => r.quarter === quarter && personKey(r) === key && r.id !== excludeId && !LIMIT_EXCLUDED.includes(r.status))
      .reduce((s, r) => s + (amountOf(r) || 0), 0);
  }

  function canUserEdit(r, now = Date.now()) {
    return USER_EDITABLE.includes(r.status) && !Store.isClosed(r.quarter) && now - r.createdAt <= EDIT_WINDOW_MS;
  }

  function quartersInUse() {
    const set = new Set(Store.requests.map((r) => r.quarter));
    set.add(Store.settings.quarter);
    return Array.from(set).sort().reverse();
  }

  function categoriesInUse() {
    const set = new Set(DEFAULT_CATEGORIES);
    Store.catalog.forEach((c) => c.category && set.add(c.category));
    const fromCatalog = Array.from(new Set(Store.catalog.map((c) => c.category).filter(Boolean)));
    const rest = Array.from(set).filter((c) => !fromCatalog.includes(c));
    return fromCatalog.concat(rest);
  }

  // 분기 + 상태 기준으로 카테고리 > 상품 단위 합산
  function aggregate(quarter) {
    const rows = Store.requests.filter((r) => r.quarter === quarter && ORDER_STATUSES.includes(r.status));
    const cats = new Map();
    rows.forEach((r) => {
      const cat = r.category || '기타';
      if (!cats.has(cat)) cats.set(cat, new Map());
      const items = cats.get(cat);
      const key = (r.code || '') + '|' + r.productName + '|' + (r.unitPrice ?? '');
      if (!items.has(key)) items.set(key, { code: r.code || '', name: r.productName, unitPrice: r.unitPrice, qty: 0, amount: 0, reqs: [] });
      const it = items.get(key);
      it.qty += r.qty;
      it.amount += amountOf(r) || 0;
      it.reqs.push(r);
    });
    const order = categoriesInUse();
    const groups = Array.from(cats.entries())
      .sort((a, b) => {
        const ia = order.indexOf(a[0]), ib = order.indexOf(b[0]);
        return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a[0].localeCompare(b[0], 'ko');
      })
      .map(([category, items]) => {
        const list = Array.from(items.values()).sort((a, b) => (a.code || 'zzz').localeCompare(b.code || 'zzz') || a.name.localeCompare(b.name, 'ko'));
        return { category, items: list, subtotal: list.reduce((s, i) => s + i.amount, 0) };
      });
    return { groups, total: groups.reduce((s, g) => s + g.subtotal, 0), count: rows.length };
  }

  function overLimitPeople(quarter) {
    const limit = Number(Store.settings.limit) || 0;
    if (!limit) return [];
    const people = new Map();
    Store.requests
      .filter((r) => r.quarter === quarter && !LIMIT_EXCLUDED.includes(r.status))
      .forEach((r) => {
        const k = personKey(r);
        if (!people.has(k)) people.set(k, { dept: r.dept, title: r.title, name: r.name, total: 0 });
        people.get(k).total += amountOf(r) || 0;
      });
    return Array.from(people.entries())
      .filter(([, p]) => p.total > limit)
      .map(([key, p]) => ({ key, ...p, over: p.total - limit }))
      .sort((a, b) => b.over - a.over);
  }

  // ------------------------------------------------------------------ 라우팅
  function route() {
    const r = location.hash.replace('#', '') || 'apply';
    const isAdmin = r === 'admin';
    $('#view-apply').hidden = isAdmin;
    $('#view-admin').hidden = !isAdmin;
    $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.route === (isAdmin ? 'admin' : 'apply')));
    if (isAdmin) Admin.enter(); else Apply.render();
  }

  function renderHeader() {
    $('#hdr-quarter').textContent = quarterLabel(Store.settings.quarter);
    $('#hdr-limit').textContent = Number(Store.settings.limit) ? won(Store.settings.limit) : '없음';
    $('#sample-banner').hidden = !Store.data.catalogIsSample;
  }

  // ================================================================== 화면 A: 신청
  const Apply = {
    mode: 'catalog',
    category: '전체',
    selected: null,       // 선택한 품목
    me: null,             // { name, pinHash } 조회 중인 사람

    init() {
      $$('#view-apply .seg-btn').forEach((b) => b.addEventListener('click', () => this.setMode(b.dataset.mode)));
      $('#q').addEventListener('input', () => this.renderCatalog());
      $('#f-qty').addEventListener('input', () => this.renderAmount());
      $('#o-price').addEventListener('input', () => this.renderAmount());
      $('#apply-form').addEventListener('submit', (e) => { e.preventDefault(); this.submit(); });
      $('#my-form').addEventListener('submit', (e) => { e.preventDefault(); this.lookup(); });
      $('#catalog-table tbody').addEventListener('click', (e) => {
        const tr = e.target.closest('tr[data-code]');
        if (tr) this.pick(tr.dataset.code);
      });
      $('#my-table tbody').addEventListener('click', (e) => this.onMyTableClick(e));
    },

    render() {
      this.renderChips();
      this.renderCatalog();
      this.renderSelects();
      this.renderSelected();
      this.renderMine();
    },

    setMode(mode) {
      this.mode = mode;
      $$('#view-apply .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
      $('#pane-catalog').hidden = mode !== 'catalog';
      $('#pane-other').hidden = mode !== 'other';
      this.renderSelected();
    },

    renderSelects() {
      const dept = $('#f-dept');
      const keep = dept.value;
      dept.innerHTML = '<option value="">부서 선택</option>' +
        Store.settings.departments.map((d) => `<option>${esc(d)}</option>`).join('');
      if (keep) dept.value = keep;
      const oc = $('#o-cat');
      const keepC = oc.value;
      oc.innerHTML = '<option value="">카테고리 선택</option>' + categoriesInUse().map((c) => `<option>${esc(c)}</option>`).join('');
      if (keepC) oc.value = keepC;
    },

    renderChips() {
      const cats = ['전체'].concat(Array.from(new Set(Store.catalog.map((c) => c.category).filter(Boolean))));
      if (!cats.includes(this.category)) this.category = '전체';
      const box = $('#cat-chips');
      box.innerHTML = cats.map((c) => `<button type="button" class="chip${c === this.category ? ' active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
      box.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
        this.category = b.dataset.cat; this.renderChips(); this.renderCatalog();
      }));
    },

    renderCatalog() {
      const q = norm($('#q').value).toLowerCase();
      const list = Store.catalog.filter((c) =>
        (this.category === '전체' || c.category === this.category) &&
        (!q || c.name.toLowerCase().includes(q) || String(c.code).toLowerCase().includes(q)));
      $('#result-count').textContent = `${list.length}개 품목`;
      const tbody = $('#catalog-table tbody');
      if (!list.length) {
        tbody.innerHTML = `<tr><td colspan="5" class="empty-row">찾는 품목이 없어요. 위의 <strong>기타 신청</strong>으로 신청할 수 있어요.</td></tr>`;
        return;
      }
      tbody.innerHTML = list.map((c) => `
        <tr class="pick${this.selected && this.selected.code === c.code ? ' selected' : ''}" data-code="${esc(c.code)}">
          <td><code>${esc(c.code)}</code></td>
          <td>${esc(c.name)}${c.unit ? ` <span class="muted small">(${esc(c.unit)})</span>` : ''}</td>
          <td>${esc(c.category)}</td>
          <td class="num">${won(c.price)}</td>
          <td><button type="button" class="btn sm">선택</button></td>
        </tr>`).join('');
    },

    pick(code) {
      this.selected = Store.catalog.find((c) => String(c.code) === code) || null;
      this.renderCatalog();
      this.renderSelected();
      $('#f-qty').focus();
    },

    renderSelected() {
      const box = $('#selected-box');
      if (this.mode === 'other') {
        box.className = 'selected';
        box.innerHTML = '<div class="name">기타 신청</div><div class="muted small">왼쪽에 적은 상품으로 신청합니다. 관리자 확인 후 주문서에 들어가요.</div>';
      } else if (this.selected) {
        const c = this.selected;
        box.className = 'selected';
        box.innerHTML = `<div class="name">${esc(c.name)}</div>
          <div class="muted small"><code>${esc(c.code)}</code> · ${esc(c.category)} · ${won(c.price)}${c.unit ? ' / ' + esc(c.unit) : ''}</div>`;
      } else {
        box.className = 'selected empty';
        box.textContent = '왼쪽 목록에서 품목을 선택하세요.';
      }
      this.renderAmount();
    },

    currentPrice() {
      if (this.mode === 'other') {
        const v = $('#o-price').value;
        return v === '' ? null : Number(v);
      }
      return this.selected ? Number(this.selected.price) : null;
    },

    renderAmount() {
      const qty = Number($('#f-qty').value) || 0;
      const p = this.currentPrice();
      $('#f-amount').textContent = p == null ? (this.mode === 'other' ? '단가 미정' : '-') : won(p * qty);
    },

    async submit() {
      const msg = $('#apply-msg');
      const qty = Math.floor(Number($('#f-qty').value));
      const dept = norm($('#f-dept').value);
      const title = norm($('#f-title').value);
      const name = norm($('#f-name').value);
      const pin = norm($('#f-pin').value);
      const memo = norm($('#f-memo').value);

      let item;
      if (this.mode === 'catalog') {
        if (!this.selected) return showMsg(msg, '먼저 왼쪽 목록에서 품목을 선택하세요.', 'err');
        item = { type: 'catalog', code: this.selected.code, productName: this.selected.name, category: this.selected.category, unitPrice: Number(this.selected.price), link: '' };
      } else {
        const oname = norm($('#o-name').value);
        if (!oname) return showMsg(msg, '기타 신청은 상품명을 꼭 적어 주세요.', 'err');
        if (!$('#o-cat').value) return showMsg(msg, '기타 신청의 카테고리를 골라 주세요.', 'err');
        const op = $('#o-price').value;
        item = { type: 'other', code: norm($('#o-code').value), productName: oname, category: $('#o-cat').value, unitPrice: op === '' ? null : Number(op), link: norm($('#o-link').value) };
      }
      if (!qty || qty < 1) return showMsg(msg, '수량은 1 이상이어야 해요.', 'err');
      if (!dept || !title || !name) return showMsg(msg, '부서명·직책명·이름을 모두 입력하세요.', 'err');
      if (!/^\d{4}$/.test(pin)) return showMsg(msg, '비밀번호는 숫자 4자리로 정해 주세요.', 'err');

      const pinHash = await hash(pin);
      const quarter = Store.settings.quarter;
      const req = {
        id: uid(), quarter, createdAt: Date.now(), updatedAt: Date.now(),
        dept, title, name, pinHash, qty, memo, ...item,
        status: item.type === 'other' ? S.PENDING : S.APPLIED, rejectReason: '',
      };

      // 한도 경고 (막지는 않음)
      const limit = Number(Store.settings.limit) || 0;
      const before = personTotal(personKey(req), quarter);
      const after = before + (amountOf(req) || 0);
      if (limit && after > limit) {
        const ok = confirm(`이번 분기 1인 한도(${won(limit)})를 넘습니다.\n\n지금까지 신청: ${won(before)}\n이번 신청 포함: ${won(after)} (초과 ${won(after - limit)})\n\n그래도 신청할까요? 관리자 화면에 '한도 초과'로 표시됩니다.`);
        if (!ok) return showMsg(msg, '신청을 취소했어요. 수량을 조정해 보세요.', 'warn');
      }

      Store.requests.push(req);
      if (!Store.save()) return;

      const over = limit && after > limit;
      showMsg(msg, `<strong>${esc(req.productName)}</strong> ${qty}개 신청 완료 (${req.status}).` +
        (over ? ` 한도를 ${won(after - limit)} 초과했어요.` : '') +
        ' 아래 내 신청 내역에서 확인할 수 있어요.', over ? 'warn' : 'ok');

      // 다음 품목을 빨리 신청할 수 있게 신청자 정보는 남기고 품목만 비웁니다.
      this.selected = null;
      $('#f-qty').value = 1; $('#f-memo').value = '';
      ['#o-link', '#o-code', '#o-name', '#o-price'].forEach((s) => { $(s).value = ''; });
      this.me = { name, pinHash };
      $('#my-name').value = name; $('#my-pin').value = pin;
      this.renderCatalog(); this.renderSelected(); this.renderMine();
    },

    async lookup() {
      const name = norm($('#my-name').value);
      const pin = norm($('#my-pin').value);
      if (!name || !/^\d{4}$/.test(pin)) { toast('이름과 비밀번호 4자리를 입력하세요.'); return; }
      this.me = { name, pinHash: await hash(pin) };
      this.renderMine();
    },

    renderMine() {
      const tbody = $('#my-table tbody');
      const sum = $('#my-summary');
      if (!this.me) { sum.textContent = ''; return; }
      const mine = Store.requests
        .filter((r) => norm(r.name) === this.me.name && r.pinHash === this.me.pinHash)
        .sort((a, b) => b.createdAt - a.createdAt);
      if (!mine.length) {
        sum.textContent = '';
        tbody.innerHTML = '<tr><td colspan="8" class="empty-row">조회된 신청이 없어요. 이름과 비밀번호를 확인하세요.</td></tr>';
        return;
      }
      const q = Store.settings.quarter;
      const total = mine.filter((r) => r.quarter === q && !LIMIT_EXCLUDED.includes(r.status)).reduce((s, r) => s + (amountOf(r) || 0), 0);
      const limit = Number(Store.settings.limit) || 0;
      sum.innerHTML = `${quarterLabel(q)} 내 신청 합계 <strong>${won(total)}</strong>` +
        (limit ? ` / 한도 ${won(limit)}${total > limit ? ' <span class="over-flag">한도 초과</span>' : ''}` : '');
      const now = Date.now();
      tbody.innerHTML = mine.map((r) => {
        const editable = canUserEdit(r, now);
        const left = Math.max(0, EDIT_WINDOW_MS - (now - r.createdAt));
        const hours = Math.floor(left / 3600000);
        let editCell;
        if (editable) {
          editCell = `<div class="row gap">
              <input type="number" class="qty-input" min="1" value="${r.qty}" data-qty="${r.id}">
              <button type="button" class="btn sm" data-save="${r.id}">수정</button>
              <button type="button" class="btn sm danger ghost" data-cancel="${r.id}">취소</button>
            </div><div class="muted small">${hours >= 1 ? hours + '시간' : Math.ceil(left / 60000) + '분'} 남음</div>`;
        } else {
          const why = !USER_EDITABLE.includes(r.status) ? '' : Store.isClosed(r.quarter) ? '분기 마감' : '3일 지남';
          editCell = `<span class="muted small">${why || '-'}</span>`;
        }
        return `<tr>
          <td>${fmtDateTime(r.createdAt)}</td>
          <td>${esc(quarterLabel(r.quarter))}</td>
          <td>${esc(r.productName)}<div class="muted small">${r.code ? `<code>${esc(r.code)}</code> · ` : ''}${esc(r.category)}${r.type === 'other' ? ' · 기타 신청' : ''}</div>
              ${r.rejectReason ? `<div class="small" style="color:var(--bad)">반려 사유: ${esc(r.rejectReason)}</div>` : ''}</td>
          <td class="num">${won(r.unitPrice)}</td>
          <td class="num">${r.qty}</td>
          <td class="num">${won(amountOf(r))}</td>
          <td><span class="status ${statusClass(r.status)}">${esc(r.status)}</span></td>
          <td>${editCell}</td>
        </tr>`;
      }).join('');
    },

    onMyTableClick(e) {
      const saveId = e.target.dataset.save;
      const cancelId = e.target.dataset.cancel;
      const id = saveId || cancelId;
      if (!id) return;
      const r = Store.requests.find((x) => x.id === id);
      if (!r || !this.me || r.pinHash !== this.me.pinHash) return;
      if (!canUserEdit(r)) { toast('수정 가능한 기간이 지났어요.'); this.renderMine(); return; }
      if (saveId) {
        const v = Math.floor(Number($(`input[data-qty="${id}"]`).value));
        if (!v || v < 1) { toast('수량은 1 이상이어야 해요.'); return; }
        const limit = Number(Store.settings.limit) || 0;
        const after = personTotal(personKey(r), r.quarter, r.id) + (r.unitPrice == null ? 0 : r.unitPrice * v);
        if (limit && after > limit && !confirm(`수정하면 이번 분기 합계가 ${won(after)}이 되어 한도(${won(limit)})를 넘습니다. 그래도 수정할까요?`)) return;
        r.qty = v; r.updatedAt = Date.now();
        Store.save(); toast('수량을 수정했어요.');
      } else {
        if (!confirm(`'${r.productName}' 신청을 취소할까요?`)) return;
        r.status = S.CANCELED; r.updatedAt = Date.now();
        Store.save(); toast('신청을 취소했어요.');
      }
      this.renderMine();
    },
  };

  // ================================================================== 화면 B: 관리자
  const Admin = {
    unlocked: false,
    tab: 'status',
    quarter: null,
    open: new Set(), // 펼친 상품 키

    init() {
      $('#lock-form').addEventListener('submit', (e) => { e.preventDefault(); this.unlock(); });
      $('#logout-btn').addEventListener('click', () => { this.unlocked = false; this.enter(); });
      $$('#admin-main .admin-bar .seg-btn').forEach((b) => b.addEventListener('click', () => this.setTab(b.dataset.admin)));
      $('#a-quarter').addEventListener('change', (e) => { this.quarter = e.target.value; this.renderStatus(); });
      $('#export-btn').addEventListener('click', () => exportOrderSheet(this.quarter));
      $('#close-btn').addEventListener('click', () => this.closeQuarter());
      $('#a-groups').addEventListener('click', (e) => this.onGroupsClick(e));
      $('#o-list').addEventListener('click', (e) => this.onOtherClick(e));
      $('#set-form').addEventListener('submit', (e) => { e.preventDefault(); this.saveSettings(); });
      $('#pw-form').addEventListener('submit', (e) => { e.preventDefault(); this.changePw(); });
      $('#cat-save').addEventListener('click', () => this.importCatalog($('#cat-paste').value));
      $('#cat-file').addEventListener('change', (e) => this.readFile(e.target, (t) => this.importCatalog(t)));
      $('#cat-template').addEventListener('click', () => download('품목목록_양식.csv', csvBlob([['상품코드', '상품명', '카테고리', '단가', '규격/단위'], ['예: 123456', 'A4 복사용지 80g 500매', '복사용지', '5900', '1권']])));
      $('#cat-export').addEventListener('click', () => download('품목목록.csv', csvBlob([['상품코드', '상품명', '카테고리', '단가', '규격/단위']].concat(Store.catalog.map((c) => [c.code, c.name, c.category, c.price, c.unit || ''])))));
      $('#backup-btn').addEventListener('click', () => download(`사무용품신청_백업_${fmtDate(Date.now())}.json`, new Blob([JSON.stringify(Store.data, null, 2)], { type: 'application/json' })));
      $('#restore-file').addEventListener('change', (e) => this.readFile(e.target, (t) => this.restore(t)));
      $('#reset-btn').addEventListener('click', () => {
        if (!confirm('모든 신청·설정·품목을 지우고 샘플 상태로 되돌립니다. 되돌릴 수 없어요. 계속할까요?')) return;
        Store.reset(); this.unlocked = false; renderHeader(); this.enter(); toast('초기화했어요.');
      });
    },

    enter() {
      renderHeader();
      const needSetup = !Store.settings.adminHash;
      $('#admin-lock').hidden = this.unlocked;
      $('#admin-main').hidden = !this.unlocked;
      if (!this.unlocked) {
        $('#lock-title').textContent = needSetup ? '관리자 비밀번호 만들기' : '관리자 로그인';
        $('#lock-desc').textContent = needSetup ? '처음 사용합니다. 관리자 비밀번호를 정해 주세요(4자 이상).' : '관리자 비밀번호를 입력하세요.';
        $('#lock-pw2').hidden = !needSetup;
        $('#lock-pw2').required = needSetup;
        $('#lock-msg').hidden = true;
        $('#lock-pw').value = ''; $('#lock-pw2').value = '';
        return;
      }
      this.render();
    },

    async unlock() {
      const pw = $('#lock-pw').value;
      const msg = $('#lock-msg');
      if (!Store.settings.adminHash) {
        if (pw.length < 4) return showMsg(msg, '4자 이상으로 정해 주세요.', 'err');
        if (pw !== $('#lock-pw2').value) return showMsg(msg, '두 비밀번호가 달라요.', 'err');
        Store.settings.adminHash = await hash('admin::' + pw);
        Store.save();
      } else if ((await hash('admin::' + pw)) !== Store.settings.adminHash) {
        return showMsg(msg, '비밀번호가 맞지 않아요.', 'err');
      }
      this.unlocked = true;
      this.enter();
    },

    setTab(tab) {
      this.tab = tab;
      $$('#admin-main .admin-bar .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.admin === tab));
      $('#admin-status').hidden = tab !== 'status';
      $('#admin-other').hidden = tab !== 'other';
      $('#admin-settings').hidden = tab !== 'settings';
      this.render();
    },

    render() {
      const pending = Store.requests.filter((r) => r.status === S.PENDING).length;
      const badge = $('#pending-badge');
      badge.hidden = !pending; badge.textContent = pending;
      if (this.tab === 'status') this.renderStatus();
      if (this.tab === 'other') this.renderOther();
      if (this.tab === 'settings') this.renderSettings();
    },

    // ---- 신청 현황
    renderStatus() {
      const qs = quartersInUse();
      if (!this.quarter || !qs.includes(this.quarter)) this.quarter = Store.settings.quarter;
      $('#a-quarter').innerHTML = qs.map((q) => `<option value="${q}"${q === this.quarter ? ' selected' : ''}>${quarterLabel(q)}${q === Store.settings.quarter ? ' (진행 중)' : ''}</option>`).join('');
      const closed = Store.isClosed(this.quarter);
      const state = $('#a-quarter-state');
      state.className = 'pill ' + (closed ? 'closed' : 'open');
      const closeInfo = Store.settings.closedQuarters.find((c) => c.quarter === this.quarter);
      state.textContent = closed ? `마감됨 · ${fmtDateTime(closeInfo.closedAt)}` : '신청 받는 중';
      $('#close-btn').disabled = closed || this.quarter !== Store.settings.quarter;

      const agg = aggregate(this.quarter);
      const people = new Set(Store.requests.filter((r) => r.quarter === this.quarter && ORDER_STATUSES.includes(r.status)).map(personKey));
      const pending = Store.requests.filter((r) => r.quarter === this.quarter && r.status === S.PENDING).length;
      const over = overLimitPeople(this.quarter);
      $('#a-stats').innerHTML = [
        ['총비용', won(agg.total)], ['신청 건수', agg.count + '건'], ['신청 인원', people.size + '명'],
        ['확인 대기 기타 신청', pending + '건'],
      ].map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');

      const overKeys = new Set(over.map((p) => p.key));
      $('#over-card').hidden = !over.length;
      $('#over-limit-label').textContent = `1인 한도 ${won(Store.settings.limit)}`;
      $('#over-table tbody').innerHTML = over.map((p) => `<tr><td>${esc(p.dept)}</td><td>${esc(p.title)}</td><td>${esc(p.name)}</td><td class="num">${won(p.total)}</td><td class="num" style="color:var(--bad);font-weight:700">${won(p.over)}</td></tr>`).join('');

      const box = $('#a-groups');
      if (!agg.groups.length) {
        box.innerHTML = '<p class="muted">이 분기에 주문서에 들어갈 신청이 아직 없어요.</p>';
        return;
      }
      box.innerHTML = agg.groups.map((g) => `
        <div class="group">
          <div class="group-head"><span>${esc(g.category)} <span class="muted small">${g.items.length}개 품목</span></span><span>소계 ${won(g.subtotal)}</span></div>
          <table class="tbl">
            <thead><tr><th>상품코드</th><th>상품명</th><th class="num">단가</th><th class="num">총수량</th><th class="num">금액</th><th class="num">신청자</th></tr></thead>
            <tbody>
              ${g.items.map((it) => {
                const key = g.category + '|' + it.code + '|' + it.name + '|' + (it.unitPrice ?? '');
                const isOpen = this.open.has(key);
                const reqRows = isOpen ? it.reqs.map((r) => `
                  <tr class="req-row">
                    <td colspan="3">${esc(r.dept)}, ${esc(r.title)}, ${esc(r.name)}${overKeys.has(personKey(r)) ? '<span class="over-flag">한도 초과</span>' : ''}
                      <span class="muted small"> · ${fmtDateTime(r.createdAt)}${r.memo ? ' · 메모: ' + esc(r.memo) : ''}${r.type === 'other' ? ' · 기타 신청' : ''}</span></td>
                    <td class="num">${r.qty}</td>
                    <td class="num">${won(amountOf(r))}</td>
                    <td class="num">${r.status === S.FIXED ? '<span class="status st-확정">확정</span>' : `<button type="button" class="btn sm danger ghost" data-admin-cancel="${r.id}">취소</button>`}</td>
                  </tr>`).join('') : '';
                return `<tr class="item-row${isOpen ? ' open' : ''}" data-key="${esc(key)}">
                  <td><span class="caret">▸</span> <code>${esc(it.code || '-')}</code></td>
                  <td>${esc(it.name)}</td>
                  <td class="num">${won(it.unitPrice)}</td>
                  <td class="num"><strong>${it.qty}</strong></td>
                  <td class="num">${won(it.amount)}</td>
                  <td class="num">${it.reqs.length}명${it.reqs.some((r) => overKeys.has(personKey(r))) ? '<span class="over-flag">초과 포함</span>' : ''}</td>
                </tr>${reqRows}`;
              }).join('')}
            </tbody>
          </table>
        </div>`).join('') +
        `<div class="group-head" style="border:1px solid var(--line);border-radius:8px"><span>총합계</span><span>${won(agg.total)}</span></div>`;
    },

    onGroupsClick(e) {
      const cancelId = e.target.dataset.adminCancel;
      if (cancelId) {
        const r = Store.requests.find((x) => x.id === cancelId);
        if (r && confirm(`${r.dept}, ${r.title}, ${r.name}의 '${r.productName}' ${r.qty}개 신청을 관리자 권한으로 취소할까요?`)) {
          r.status = S.CANCELED; r.rejectReason = '관리자 취소'; r.updatedAt = Date.now();
          Store.save(); toast('취소했어요.'); this.render();
        }
        return;
      }
      const row = e.target.closest('.item-row');
      if (!row) return;
      const key = row.dataset.key;
      this.open.has(key) ? this.open.delete(key) : this.open.add(key);
      this.renderStatus();
    },

    closeQuarter() {
      const q = Store.settings.quarter;
      const next = nextQuarter(q);
      const pending = Store.requests.filter((r) => r.quarter === q && r.status === S.PENDING);
      const text = `${quarterLabel(q)}를 마감합니다.\n\n· 지금까지의 신청·승인 건이 '확정'되어 더 이상 수정·취소할 수 없어요.\n· 이후 신청은 ${quarterLabel(next)}로 들어가요.` +
        (pending.length ? `\n· 확인 대기 중인 기타 신청 ${pending.length}건은 ${quarterLabel(next)}로 넘어가요.` : '') +
        '\n\n마감할까요?';
      if (!confirm(text)) return;
      const now = Date.now();
      Store.requests.forEach((r) => {
        if (r.quarter !== q) return;
        if (r.status === S.APPLIED || r.status === S.APPROVED) { r.status = S.FIXED; r.updatedAt = now; }
        else if (r.status === S.PENDING) { r.quarter = next; r.updatedAt = now; }
      });
      Store.settings.closedQuarters.push({ quarter: q, closedAt: now });
      Store.settings.quarter = next;
      Store.save();
      this.quarter = q;
      renderHeader();
      this.render();
      toast(`${quarterLabel(q)} 마감 완료. 이제 주문서를 내려받으세요.`);
    },

    // ---- 기타 신청
    renderOther() {
      const pending = Store.requests.filter((r) => r.status === S.PENDING).sort((a, b) => a.createdAt - b.createdAt);
      const cats = categoriesInUse();
      $('#o-list').innerHTML = pending.length ? pending.map((r) => `
        <div class="other-card" data-id="${r.id}">
          <div class="meta">${esc(quarterLabel(r.quarter))} · ${fmtDateTime(r.createdAt)} · <strong>${esc(r.dept)}, ${esc(r.title)}, ${esc(r.name)}</strong> · 수량 ${r.qty}${r.memo ? ' · 메모: ' + esc(r.memo) : ''}
            ${r.link ? `<br>링크: <a href="${esc(r.link)}" target="_blank" rel="noopener">${esc(r.link)}</a>` : '<br>링크 없음'}</div>
          <div class="form-grid">
            <label>상품코드<input data-f="code" value="${esc(r.code)}"></label>
            <label>상품명<input data-f="productName" value="${esc(r.productName)}"></label>
            <label>카테고리<select data-f="category">${cats.map((c) => `<option${c === r.category ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
            <label>단가(원)<input data-f="unitPrice" type="number" min="0" value="${r.unitPrice ?? ''}"></label>
          </div>
          <div class="actions">
            <input class="reject-reason" data-f="reason" placeholder="반려 사유">
            <button type="button" class="btn danger ghost" data-act="reject">반려</button>
            <button type="button" class="btn primary" data-act="approve">승인</button>
          </div>
        </div>`).join('') : '<p class="muted">확인 대기 중인 기타 신청이 없어요.</p>';

      const done = Store.requests.filter((r) => r.type === 'other' && r.status !== S.PENDING).sort((a, b) => b.updatedAt - a.updatedAt);
      $('#o-done tbody').innerHTML = done.length ? done.map((r) => `<tr>
          <td>${esc(quarterLabel(r.quarter))}</td><td>${esc(r.dept)}, ${esc(r.title)}, ${esc(r.name)}</td>
          <td>${esc(r.productName)}<div class="muted small">${r.code ? `<code>${esc(r.code)}</code> · ` : ''}${won(r.unitPrice)}</div></td>
          <td class="num">${r.qty}</td><td><span class="status ${statusClass(r.status)}">${esc(r.status)}</span></td><td>${esc(r.rejectReason)}</td></tr>`).join('')
        : '<tr><td colspan="6" class="empty-row">아직 없어요.</td></tr>';
    },

    onOtherClick(e) {
      const act = e.target.dataset.act;
      if (!act) return;
      const card = e.target.closest('.other-card');
      const r = Store.requests.find((x) => x.id === card.dataset.id);
      if (!r) return;
      const val = (f) => $(`[data-f="${f}"]`, card).value;
      if (act === 'approve') {
        const name = norm(val('productName'));
        const price = val('unitPrice');
        if (!name) return toast('상품명을 입력하세요.');
        if (price === '') return toast('승인하려면 단가를 입력하세요(주문서 금액 계산에 필요).');
        Object.assign(r, { code: norm(val('code')), productName: name, category: val('category'), unitPrice: Number(price), status: S.APPROVED, updatedAt: Date.now() });
        toast('승인했어요. 신청 현황과 주문서에 들어갑니다.');
      } else {
        const reason = norm(val('reason'));
        if (!reason) return toast('반려 사유를 적어 주세요.');
        Object.assign(r, { status: S.REJECTED, rejectReason: reason, updatedAt: Date.now() });
        toast('반려했어요.');
      }
      Store.save();
      this.render();
    },

    // ---- 설정·품목
    renderSettings() {
      const s = Store.settings;
      $('#s-quarter').value = s.quarter;
      $('#s-limit').value = s.limit;
      $('#s-writer').value = s.writer || '';
      $('#s-depts').value = s.departments.join('\n');
      $('#cat-count').textContent = `현재 ${Store.catalog.length}개${Store.data.catalogIsSample ? ' (샘플)' : ''}`;
    },

    saveSettings() {
      const q = norm($('#s-quarter').value).toUpperCase();
      if (!/^\d{4}-Q[1-4]$/.test(q)) return showMsg($('#set-msg'), '분기는 2026-Q4 형식으로 입력하세요.', 'err');
      if (Store.isClosed(q)) return showMsg($('#set-msg'), '이미 마감한 분기로는 바꿀 수 없어요.', 'err');
      const depts = $('#s-depts').value.split('\n').map(norm).filter(Boolean);
      if (!depts.length) return showMsg($('#set-msg'), '부서를 하나 이상 입력하세요.', 'err');
      Object.assign(Store.settings, { quarter: q, limit: Math.max(0, Number($('#s-limit').value) || 0), writer: norm($('#s-writer').value), departments: Array.from(new Set(depts)) });
      Store.save();
      renderHeader();
      showMsg($('#set-msg'), '저장했어요.', 'ok');
    },

    async changePw() {
      const pw = $('#pw-new').value;
      if (pw.length < 4) return toast('4자 이상으로 정해 주세요.');
      Store.settings.adminHash = await hash('admin::' + pw);
      Store.save();
      $('#pw-new').value = '';
      toast('관리자 비밀번호를 바꿨어요.');
    },

    readFile(input, cb) {
      const f = input.files && input.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => { cb(String(reader.result)); input.value = ''; };
      reader.readAsText(f, 'utf-8');
    },

    importCatalog(text) {
      const msg = $('#cat-msg');
      const rows = parseTable(text);
      if (!rows.length) return showMsg(msg, '붙여 넣은 내용이 없어요.', 'err');
      if (rows[0].length && /상품\s*코드|code/i.test(rows[0][0])) rows.shift();
      const items = [], errors = [], seen = new Set();
      rows.forEach((cols, i) => {
        const [code, name, category, price, unit] = cols.map(norm);
        if (!code && !name) return;
        const p = Number(String(price || '').replace(/[,원\s]/g, ''));
        if (!code || !name || !category || !isFinite(p) || price === '') { errors.push(i + 1); return; }
        if (seen.has(code)) { errors.push(i + 1); return; }
        seen.add(code);
        items.push({ code, name, category, price: p, unit: unit || '' });
      });
      if (!items.length) return showMsg(msg, '읽을 수 있는 품목이 없어요. 열 순서(상품코드·상품명·카테고리·단가·규격/단위)를 확인하세요.', 'err');
      if (!confirm(`품목 ${items.length}개로 목록을 교체할까요?` + (errors.length ? `\n(${errors.length}줄은 빈 칸·중복 코드·단가 오류로 건너뜁니다)` : ''))) return;
      Store.data.catalog = items;
      Store.data.catalogIsSample = false;
      Store.save();
      $('#cat-paste').value = '';
      renderHeader();
      this.renderSettings();
      showMsg(msg, `품목 ${items.length}개로 교체했어요.` + (errors.length ? ` 건너뛴 줄: ${errors.slice(0, 15).join(', ')}${errors.length > 15 ? ' …' : ''}` : ''), errors.length ? 'warn' : 'ok');
    },

    restore(text) {
      try {
        const d = JSON.parse(text);
        if (!d || !d.settings || !Array.isArray(d.requests) || !Array.isArray(d.catalog)) throw new Error('형식 오류');
        if (!confirm(`백업 파일로 복원하면 지금 데이터를 덮어씁니다. (신청 ${d.requests.length}건, 품목 ${d.catalog.length}개)\n계속할까요?`)) return;
        Store.data = d;
        Store.normalize();
        Store.save();
        renderHeader();
        this.render();
        showMsg($('#backup-msg'), '복원했어요.', 'ok');
      } catch (e) {
        showMsg($('#backup-msg'), '백업 파일을 읽지 못했어요. 이 앱에서 받은 .json 파일인지 확인하세요.', 'err');
      }
    },
  };

  // ------------------------------------------------------------------ CSV/TSV
  function parseTable(text) {
    text = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
    if (!text) return [];
    const firstLine = text.split('\n')[0];
    const delim = firstLine.includes('\t') ? '\t' : ',';
    const rows = [];
    let row = [], cell = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') inQ = false;
        else cell += ch;
      } else if (ch === '"' && cell === '') inQ = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    row.push(cell); rows.push(row);
    return rows.filter((r) => r.some((c) => norm(c)));
  }
  function csvBlob(rows) {
    const body = rows.map((r) => r.map((c) => {
      const s = String(c ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')).join('\r\n');
    return new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' }); // BOM: 엑셀 한글 깨짐 방지
  }

  // ================================================================== 주문서 엑셀(.xlsx) — 라이브러리 없이 직접 생성
  function exportOrderSheet(quarter) {
    const agg = aggregate(quarter);
    if (!agg.groups.length) { toast('주문서에 넣을 신청이 없어요.'); return; }
    const [y, qn] = quarter.split('-Q');
    const title = `${y}년 ${qn}분기 사무용품 주문서`;
    const closed = Store.isClosed(quarter);

    // 스타일 번호 (styles.xml의 cellXfs 순서와 맞춤)
    const X = { TITLE: 1, CELL: 2, NUM: 3, HEAD: 4, WRAP: 5, SUB_L: 6, SUB_N: 7, TOT_L: 8, TOT_N: 9, INFO: 10, SIGN_H: 11, SIGN: 12, CENTER: 13 };
    const rows = []; // { r, ht, cells: [{c, v, s, t:'n'|'s'}] }
    const merges = [];
    const add = (cells, ht) => { rows.push({ r: rows.length + 1, ht, cells }); return rows.length; };

    add([{ c: 'A', v: title, s: X.TITLE }], 30);
    merges.push('A1:E1');
    add([
      { c: 'A', v: `작성일: ${fmtDate(Date.now())}`, s: X.INFO },
      { c: 'C', v: `작성자: ${Store.settings.writer || ''}`, s: X.INFO },
      { c: 'F', v: '담당', s: X.SIGN_H }, { c: 'G', v: '팀장', s: X.SIGN_H },
    ], 20);
    add([
      { c: 'A', v: `분기 상태: ${closed ? '마감' : '진행 중(미마감)'} · 1인 한도 ${won(Store.settings.limit)}`, s: X.INFO },
      { c: 'F', v: '', s: X.SIGN }, { c: 'G', v: '', s: X.SIGN },
    ], 42);
    add([], 8);
    const headerRow = add(['카테고리', '상품코드', '상품명', '단가(원)', '총수량', '금액(원)', '부서명, 직책명, 신청자 이름(수량)']
      .map((v, i) => ({ c: 'ABCDEFG'[i], v, s: X.HEAD })), 22);

    agg.groups.forEach((g) => {
      g.items.forEach((it) => {
        const names = it.reqs.map((r) => `${r.dept}, ${r.title}, ${r.name}(${r.qty})`);
        add([
          { c: 'A', v: g.category, s: X.CENTER },
          { c: 'B', v: it.code || '-', s: X.CENTER },
          { c: 'C', v: it.name, s: X.WRAP },
          { c: 'D', v: it.unitPrice ?? 0, s: X.NUM, t: 'n' },
          { c: 'E', v: it.qty, s: X.NUM, t: 'n' },
          { c: 'F', f: `D${rows.length + 1}*E${rows.length + 1}`, v: it.amount, s: X.NUM, t: 'n' },
          { c: 'G', v: names.join('\n'), s: X.WRAP },
        ], Math.max(1, names.length, Math.ceil(it.name.length / 22)) * 15 + 6);
      });
      const first = rows.length - g.items.length + 1, last = rows.length;
      const r = add([
        { c: 'A', v: `${g.category} 소계`, s: X.SUB_L }, { c: 'B', v: '', s: X.SUB_L }, { c: 'C', v: '', s: X.SUB_L }, { c: 'D', v: '', s: X.SUB_L },
        { c: 'E', f: `SUM(E${first}:E${last})`, v: g.items.reduce((s, i) => s + i.qty, 0), s: X.SUB_N, t: 'n' },
        { c: 'F', f: `SUM(F${first}:F${last})`, v: g.subtotal, s: X.SUB_N, t: 'n' },
        { c: 'G', v: '', s: X.SUB_L },
      ], 20);
      merges.push(`A${r}:D${r}`);
      g.subRow = r;
    });
    const totRow = add([
      { c: 'A', v: '총합계', s: X.TOT_L }, { c: 'B', v: '', s: X.TOT_L }, { c: 'C', v: '', s: X.TOT_L }, { c: 'D', v: '', s: X.TOT_L }, { c: 'E', v: '', s: X.TOT_L },
      { c: 'F', f: agg.groups.map((g) => `F${g.subRow}`).join('+'), v: agg.total, s: X.TOT_N, t: 'n' },
      { c: 'G', v: '', s: X.TOT_L },
    ], 24);
    merges.push(`A${totRow}:E${totRow}`);

    const xml = buildXlsx({ rows, merges, headerRow, sheetName: '주문서' });
    download(`${title}.xlsx`, xml);
    toast('주문서 엑셀을 내려받았어요.');
  }

  function buildXlsx({ rows, merges, headerRow, sheetName }) {
    const x = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const cols = [14, 13, 34, 12, 9, 14, 40];
    const sheetRows = rows.map((row) => {
      const cells = row.cells.map((c) => {
        const ref = c.c + row.r;
        if (c.t === 'n') {
          return `<c r="${ref}" s="${c.s}">${c.f ? `<f>${x(c.f)}</f>` : ''}<v>${Number(c.v) || 0}</v></c>`;
        }
        if (c.v === '' || c.v == null) return `<c r="${ref}" s="${c.s}"/>`;
        return `<c r="${ref}" s="${c.s}" t="inlineStr"><is><t xml:space="preserve">${x(c.v)}</t></is></c>`;
      }).join('');
      return `<row r="${row.r}"${row.ht ? ` ht="${row.ht}" customHeight="1"` : ''}>${cells}</row>`;
    }).join('');

    const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="16.5"/>
<cols>${cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>
<sheetData>${sheetRows}</sheetData>
${merges.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : ''}
<printOptions horizontalCentered="1"/>
<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>
<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>
<headerFooter><oddFooter>&amp;C&amp;P / &amp;N</oddFooter></headerFooter>
</worksheet>`;

    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0"/></numFmts>
<fonts count="4">
 <font><sz val="10"/><name val="맑은 고딕"/><family val="3"/><charset val="129"/></font>
 <font><b/><sz val="10"/><name val="맑은 고딕"/><family val="3"/><charset val="129"/></font>
 <font><b/><sz val="16"/><name val="맑은 고딕"/><family val="3"/><charset val="129"/></font>
 <font><sz val="9"/><color rgb="FF555555"/><name val="맑은 고딕"/><family val="3"/><charset val="129"/></font>
</fonts>
<fills count="4">
 <fill><patternFill patternType="none"/></fill>
 <fill><patternFill patternType="gray125"/></fill>
 <fill><patternFill patternType="solid"><fgColor rgb="FFDCE6F2"/><bgColor indexed="64"/></patternFill></fill>
 <fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
 <border><left/><right/><top/><bottom/><diagonal/></border>
 <border><left style="thin"><color rgb="FF999999"/></left><right style="thin"><color rgb="FF999999"/></right><top style="thin"><color rgb="FF999999"/></top><bottom style="thin"><color rgb="FF999999"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="14">
 <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
 <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
 <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
 <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
 <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
 <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
 <xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
 <xf numFmtId="164" fontId="1" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
 <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
 <xf numFmtId="164" fontId="1" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
 <xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
 <xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
 <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
 <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

    const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${x(sheetName)}" sheetId="1" r:id="rId1"/></sheets>
<definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">'${x(sheetName)}'!$${headerRow}:$${headerRow}</definedName></definedNames>
<calcPr calcId="191029" fullCalcOnLoad="1"/>
</workbook>`;

    const files = [
      ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`],
      ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
      ['xl/workbook.xml', workbook],
      ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
      ['xl/styles.xml', styles],
      ['xl/worksheets/sheet1.xml', sheet],
    ];
    return new Blob([zipStore(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  // 압축 없는(STORE) ZIP 생성기
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function zipStore(files) {
    const enc = new TextEncoder();
    const chunks = [], central = [];
    let offset = 0;
    const d = new Date();
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    files.forEach(([name, content]) => {
      const nameB = enc.encode(name), data = enc.encode(content), crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
      local.setUint16(8, 0, true); local.setUint16(10, dosTime, true); local.setUint16(12, dosDate, true);
      local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true);
      local.setUint16(26, nameB.length, true); local.setUint16(28, 0, true);
      chunks.push(new Uint8Array(local.buffer), nameB, data);
      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true);
      cen.setUint16(10, 0, true); cen.setUint16(12, dosTime, true); cen.setUint16(14, dosDate, true);
      cen.setUint32(16, crc, true); cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true);
      cen.setUint16(28, nameB.length, true); cen.setUint32(42, offset, true);
      central.push(new Uint8Array(cen.buffer), nameB);
      offset += 30 + nameB.length + data.length;
    });
    const cenSize = central.reduce((s, c) => s + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cenSize, true); end.setUint32(16, offset, true);
    const all = chunks.concat(central, [new Uint8Array(end.buffer)]);
    const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
    let p = 0; all.forEach((c) => { out.set(c, p); p += c.length; });
    return out;
  }

  // ------------------------------------------------------------------ 시작
  Store.load();
  Store.save();
  Apply.init();
  Admin.init();
  renderHeader();
  window.addEventListener('hashchange', route);
  window.addEventListener('storage', (e) => { if (e.key === STORAGE_KEY) { Store.load(); renderHeader(); route(); } });
  route();
})();
