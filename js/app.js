/*!
 * GestCom — app shell, views, and interactions.
 * Vanilla JS, hash routing, native <dialog>.
 */
(function () {
  'use strict';

  const store = window.GestCom.store;
  const fmt = window.GestCom.fmt;
  const todayISO = window.GestCom.todayISO;

  const $ = function (sel, root) { return (root || document).querySelector(sel); };
  const $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  const viewEl = $('#view');
  const searchInput = $('#global-search');
  const searchPanel = $('#search-panel');
  const themeToggle = $('#theme-toggle');
  const modal = $('#modal');
  const toastsEl = $('#toasts');

  const ui = {
    view: 'dashboard',
    orderSearch: '',
    orderStatus: 'all',
    orderSort: 'newest',
    clientSearch: '',
    clientSort: 'name',
    productSearch: '',
    productCategory: 'all',
    productStock: 'all',
    productSort: 'name',
    pendingOpen: null
  };

  let lastFocus = null;

  const ROUTES = {
    dashboard: { title: 'Overview', render: renderDashboard },
    orders: { title: 'Orders', render: renderOrders },
    clients: { title: 'Clients', render: renderClients },
    products: { title: 'Products', render: renderProducts },
    data: { title: 'Data & backups', render: renderData }
  };

  /* ------------------------------- helpers ------------------------------ */

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function icon(name, cls) {
    return '<svg class="icon ' + (cls || '') + '" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
  }

  function avatarTone(name) {
    let hash = 0;
    String(name || '').split('').forEach(function (ch) { hash = (hash * 31 + ch.charCodeAt(0)) >>> 0; });
    return hash % 6;
  }

  function clientName(client) { return fmt.fullName(client); }

  function personCell(client) {
    if (!client) return '<span class="muted">Deleted client</span>';
    const name = clientName(client);
    return '<div class="person">' +
      '<span class="avatar avatar--' + avatarTone(name) + '" aria-hidden="true">' + esc(fmt.initials(client.firstName, client.lastName)) + '</span>' +
      '<div class="person-text"><span class="cell-title">' + esc(name) + '</span>' +
      '<span class="cell-sub">' + esc(client.city || '—') + '</span></div></div>';
  }

  function statusMeta(id) {
    return store.STATUSES.find(function (s) { return s.id === id; }) || { id: id, label: id };
  }

  function statusPill(id) {
    const meta = statusMeta(id);
    return '<span class="pill pill--' + esc(meta.id) + '">' + esc(meta.label) + '</span>';
  }

  function stockState(product) {
    if (product.stock === 0) return 'out';
    if (product.stock <= product.reorder) return 'low';
    return 'ok';
  }

  function stockPill(product) {
    const state = stockState(product);
    const label = state === 'out' ? 'Out of stock' : state === 'low' ? 'Low stock' : 'In stock';
    return '<span class="pill pill--stock-' + state + '">' + label + '</span>';
  }

  function deltaTag(value, invert) {
    const rounded = Math.round(value * 10) / 10;
    if (!rounded) return '<span class="delta delta--flat">No change</span>';
    const good = invert ? rounded < 0 : rounded > 0;
    return '<span class="delta ' + (good ? 'delta--good' : 'delta--bad') + '">' +
      icon(rounded > 0 ? 'arrow-up' : 'arrow-down') + (rounded > 0 ? '+' : '') + rounded + '%</span>';
  }

  function pageHead(eyebrow, title, lede, actions) {
    return '<div class="page-head"><div class="page-head-copy">' +
      (eyebrow ? '<p class="eyebrow">' + eyebrow + '</p>' : '') +
      '<h1>' + title + '</h1>' +
      (lede ? '<p class="lede">' + lede + '</p>' : '') +
      '</div>' + (actions ? '<div class="head-actions">' + actions + '</div>' : '') + '</div>';
  }

  function emptyState(iconName, title, text, action) {
    return '<div class="empty">' +
      '<span class="empty-icon">' + icon(iconName) + '</span>' +
      '<h3>' + title + '</h3><p>' + text + '</p>' +
      (action || '') + '</div>';
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1).replace(/\.0$/, '') + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '') + ' MB';
  }

  /* -------------------------------- theme ------------------------------- */

  function resolvedTheme() {
    const pref = store.getSettings().theme || 'system';
    if (pref === 'system') {
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return pref;
  }

  function applyTheme() {
    const theme = resolvedTheme();
    document.documentElement.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0b1210' : '#f4f6f3');
    if (themeToggle) {
      themeToggle.setAttribute('aria-label', 'Switch to ' + (theme === 'dark' ? 'light' : 'dark') + ' theme');
      themeToggle.title = 'Switch to ' + (theme === 'dark' ? 'light' : 'dark') + ' theme';
    }
    $$('[data-theme-value]').forEach(function (btn) {
      const active = btn.dataset.themeValue === (store.getSettings().theme || 'system');
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }

  function toggleTheme() {
    store.updateSettings({ theme: resolvedTheme() === 'dark' ? 'light' : 'dark' });
    applyTheme();
  }

  function setTheme(value) {
    if (['light', 'dark', 'system'].indexOf(value) === -1) return;
    store.updateSettings({ theme: value });
    applyTheme();
  }

  /* -------------------------------- routing ----------------------------- */

  function parseRoute() {
    const raw = (location.hash || '').replace(/^#\/?/, '').split('?')[0].toLowerCase();
    return ROUTES[raw] ? raw : 'dashboard';
  }

  function navigate(hash) {
    if (location.hash === hash) renderRoute();
    else location.hash = hash;
  }

  function renderRoute() {
    const name = parseRoute();
    ui.view = name;
    $$('[data-nav]').forEach(function (link) {
      if (link.dataset.nav === name) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    document.title = ROUTES[name].title + ' · GestCom';
    closeNav();
    hideSearch();
    renderView();
    window.scrollTo({ top: 0, behavior: 'auto' });
    viewEl.focus({ preventScroll: true });

    if (ui.pendingOpen) {
      const pending = ui.pendingOpen;
      ui.pendingOpen = null;
      if (pending.kind === 'client') openClientDialog(pending.id);
      if (pending.kind === 'product') openProductDialog(pending.id);
      if (pending.kind === 'order') openOrderDialog(pending.id);
    }
  }

  function renderView() {
    const name = parseRoute();
    const route = ROUTES[name];
    viewEl.classList.remove('view-enter');
    viewEl.innerHTML = route.render();
    void viewEl.offsetWidth;
    viewEl.classList.add('view-enter');
    updateSidebarMeta();
    window.requestAnimationFrame(fitCharts);
  }

  function fitCharts() {
    const host = $('[data-chart]');
    if (!host) return;
    const width = host.clientWidth - 28;
    if (width > 0) host.innerHTML = revenueChart(store.stats().series, width);
  }

  function refresh() {
    renderView();
  }

  function rerenderPreservingFocus(inputId) {
    const current = document.getElementById(inputId);
    const position = current && current.selectionStart;
    renderView();
    const next = document.getElementById(inputId);
    if (next) {
      next.focus();
      if (position != null && next.setSelectionRange) {
        try { next.setSelectionRange(position, position); } catch (err) { /* type mismatch */ }
      }
    }
  }

  function updateSidebarMeta() {
    const pending = store.getOrders().filter(function (o) { return o.status === 'pending'; }).length;
    const low = store.getProducts().filter(function (p) { return p.stock <= p.reorder; }).length;
    const ordersBadge = $('#nav-orders-badge');
    const productsBadge = $('#nav-products-badge');
    if (ordersBadge) { ordersBadge.textContent = pending; ordersBadge.hidden = !pending; }
    if (productsBadge) { productsBadge.textContent = low; productsBadge.hidden = !low; }

    const info = store.storageInfo();
    const pct = Math.max(1, Math.round(info.percent));
    const bar = $('#usage-bar');
    const label = $('#usage-pct');
    const note = $('#storage-note');
    if (bar) bar.style.width = pct + '%';
    if (label) label.textContent = pct + '%';
    if (note) {
      const counts = store.getState();
      note.textContent = fmt.plural(counts.orders.length, 'order') + ' · ' + formatBytes(info.bytes) + ' used' + (info.demo ? ' · demo' : '');
    }
  }

  function toggleNav(force) {
    const open = force == null ? !document.body.classList.contains('nav-open') : force;
    document.body.classList.toggle('nav-open', open);
    const btn = $('.mobile-menu-btn');
    if (btn) btn.setAttribute('aria-expanded', String(open));
  }

  function closeNav() { toggleNav(false); }

  /* ------------------------------- search ------------------------------- */

  function hideSearch() {
    if (!searchPanel) return;
    searchPanel.hidden = true;
  }

  function updateSearch(raw) {
    const query = String(raw || '').trim();
    if (query.length < 2) { hideSearch(); return; }
    const lower = query.toLowerCase();
    const clients = store.getClients().filter(function (c) {
      return [clientName(c), c.email, c.city, c.phone].join(' ').toLowerCase().indexOf(lower) !== -1;
    }).slice(0, 4);
    const products = store.getProducts().filter(function (p) {
      return [p.name, p.sku, p.category].join(' ').toLowerCase().indexOf(lower) !== -1;
    }).slice(0, 4);
    const orders = store.getOrders().slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).filter(function (o) {
      const client = store.getClient(o.clientId);
      return [o.number, clientName(client), o.status].join(' ').toLowerCase().indexOf(lower) !== -1;
    }).slice(0, 4);

    if (!clients.length && !products.length && !orders.length) {
      searchPanel.innerHTML = '<div class="search-empty">' + icon('search') +
        '<p>No matches for “' + esc(query) + '”</p><span>Try a client name, SKU, or order number.</span></div>';
    } else {
      let html = '';
      if (clients.length) {
        html += '<p class="search-group">Clients</p>' + clients.map(function (c) {
          const name = clientName(c);
          return '<button type="button" class="search-result" data-action="search-open" data-kind="client" data-id="' + c.id + '">' +
            '<span class="avatar avatar--' + avatarTone(name) + '" aria-hidden="true">' + esc(fmt.initials(c.firstName, c.lastName)) + '</span>' +
            '<span class="search-result-text"><strong>' + esc(name) + '</strong><small>' + esc(c.city || 'No city') + ' · ' + esc(c.email || 'No email') + '</small></span>' +
            icon('arrow-up-right') + '</button>';
        }).join('');
      }
      if (products.length) {
        html += '<p class="search-group">Products</p>' + products.map(function (p) {
          return '<button type="button" class="search-result" data-action="search-open" data-kind="product" data-id="' + p.id + '">' +
            '<span class="result-icon">' + icon('box') + '</span>' +
            '<span class="search-result-text"><strong>' + esc(p.name) + '</strong><small>' + esc(p.sku) + ' · ' + esc(p.category) + '</small></span>' +
            icon('arrow-up-right') + '</button>';
        }).join('');
      }
      if (orders.length) {
        html += '<p class="search-group">Orders</p>' + orders.map(function (o) {
          const client = store.getClient(o.clientId);
          return '<button type="button" class="search-result" data-action="search-open" data-kind="order" data-id="' + o.id + '">' +
            '<span class="result-icon">' + icon('receipt') + '</span>' +
            '<span class="search-result-text"><strong>' + esc(o.number) + ' · ' + esc(fmt.money(store.orderTotal(o))) + '</strong><small>' + esc(clientName(client)) + ' · ' + esc(fmt.date(o.date)) + '</small></span>' +
            statusPill(o.status) + '</button>';
        }).join('');
      }
      searchPanel.innerHTML = html;
    }
    searchPanel.hidden = false;
  }

  function openSearchResult(kind, id) {
    hideSearch();
    searchInput.value = '';
    ui.pendingOpen = { kind: kind, id: id };
    const target = kind === 'client' ? 'clients' : kind === 'product' ? 'products' : 'orders';
    navigate('#/' + target);
  }

  /* ----------------------------- global events -------------------------- */

  function bindEvents() {
    document.addEventListener('click', function (event) {
      const actionEl = event.target.closest('[data-action]');
      if (!actionEl) {
        if (!event.target.closest('.search')) hideSearch();
        return;
      }
      const action = actionEl.dataset.action;
      const id = actionEl.dataset.id;

      switch (action) {
        case 'toggle-nav': event.preventDefault(); toggleNav(); break;
        case 'close-nav': closeNav(); break;
        case 'toggle-theme': toggleTheme(); break;
        case 'new-order': openOrderDialog(null); break;
        case 'new-client': openClientDialog(null); break;
        case 'new-product': openProductDialog(null); break;
        case 'edit-order': openOrderDialog(id); break;
        case 'delete-order': deleteOrder(id); break;
        case 'edit-client': openClientDialog(id); break;
        case 'delete-client': deleteClient(id); break;
        case 'edit-product': openProductDialog(id); break;
        case 'delete-product': deleteProduct(id); break;
        case 'close-modal': closeModal(); break;
        case 'add-line': event.preventDefault(); addOrderLine(); break;
        case 'remove-line': event.preventDefault(); removeOrderLine(actionEl); break;
        case 'search-open': openSearchResult(actionEl.dataset.kind, id); break;
        case 'print-orders': window.print(); break;
        case 'export-json': exportJSON(); break;
        case 'export-csv': exportCSV(actionEl.dataset.entity); break;
        case 'reset-demo': resetDemoAction(); break;
        case 'clear-data': clearDataAction(); break;
        case 'set-theme': setTheme(actionEl.dataset.themeValue); break;
        case 'filter-low-stock':
          ui.productStock = 'low'; ui.productSearch = ''; ui.productCategory = 'all';
          navigate('#/products');
          break;
        case 'clear-order-filters':
          ui.orderSearch = ''; ui.orderStatus = 'all'; ui.orderSort = 'newest'; renderView(); break;
        case 'clear-client-filters':
          ui.clientSearch = ''; ui.clientSort = 'name'; renderView(); break;
        case 'clear-product-filters':
          ui.productSearch = ''; ui.productCategory = 'all'; ui.productStock = 'all'; ui.productSort = 'name'; renderView(); break;
        default: break;
      }
    });

    document.addEventListener('input', function (event) {
      const target = event.target;
      if (target.id === 'global-search') { updateSearch(target.value); return; }
      if (target.id === 'order-search') { ui.orderSearch = target.value; rerenderPreservingFocus('order-search'); return; }
      if (target.id === 'client-search') { ui.clientSearch = target.value; rerenderPreservingFocus('client-search'); return; }
      if (target.id === 'product-search') { ui.productSearch = target.value; rerenderPreservingFocus('product-search'); return; }
      if (target.matches('[data-line-qty]')) { recalcOrderTotals(); return; }
      const field = target.closest('.field.is-invalid');
      if (field) field.classList.remove('is-invalid');
    });

    document.addEventListener('change', function (event) {
      const target = event.target;
      if (target.id === 'order-status-filter') { ui.orderStatus = target.value; renderView(); return; }
      if (target.id === 'order-sort') { ui.orderSort = target.value; renderView(); return; }
      if (target.id === 'client-sort') { ui.clientSort = target.value; renderView(); return; }
      if (target.id === 'product-category') { ui.productCategory = target.value; renderView(); return; }
      if (target.id === 'product-stock') { ui.productStock = target.value; renderView(); return; }
      if (target.id === 'product-sort') { ui.productSort = target.value; renderView(); return; }
      if (target.id === 'import-file') { handleImportFile(target.files && target.files[0]); return; }
      if (target.matches('[data-line-product]')) {
        const line = target.closest('[data-line]');
        const product = store.getProduct(target.value);
        if (line && product) line.dataset.price = product.price;
        recalcOrderTotals();
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        hideSearch();
        if (!modal.open) closeNav();
      }
      if (event.key === '/' && !modal.open && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
        event.preventDefault();
        searchInput.focus();
        searchInput.select();
      }
      if ((event.key === 'Enter') && document.activeElement && document.activeElement.matches('tr[data-action]')) {
        event.preventDefault();
        document.activeElement.click();
      }
    });

    document.addEventListener('dragover', function (event) {
      const zone = event.target.closest('#dropzone');
      if (zone) { event.preventDefault(); zone.classList.add('is-dragover'); }
    });
    document.addEventListener('dragleave', function (event) {
      const zone = event.target.closest('#dropzone');
      if (zone) zone.classList.remove('is-dragover');
    });
    document.addEventListener('drop', function (event) {
      const zone = event.target.closest('#dropzone');
      if (!zone) return;
      event.preventDefault();
      zone.classList.remove('is-dragover');
      const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
      if (file) handleImportFile(file);
    });

    window.addEventListener('hashchange', renderRoute);

    let resizeTimer = 0;
    window.addEventListener('resize', function () {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(fitCharts, 150);
    });

    if (window.matchMedia) {
      const media = window.matchMedia('(prefers-color-scheme: dark)');
      const listener = function () { if ((store.getSettings().theme || 'system') === 'system') applyTheme(); };
      if (media.addEventListener) media.addEventListener('change', listener);
      else if (media.addListener) media.addListener(listener);
    }

    modal.addEventListener('close', function () {
      document.body.classList.remove('modal-open');
      modal.innerHTML = '';
      if (lastFocus && document.contains(lastFocus)) {
        try { lastFocus.focus({ preventScroll: true }); } catch (err) { /* detached */ }
      }
    });
    modal.addEventListener('click', function (event) {
      if (event.target === modal) closeModal();
    });
  }

  function init() {
    store.load();
    applyTheme();
    bindEvents();
    renderRoute();
  }

  document.addEventListener('DOMContentLoaded', init);

  /* ------------------------------ dashboard ----------------------------- */

  function kpiCard(opts) {
    return '<article class="kpi ' + (opts.warn ? 'kpi--warn' : '') + '">' +
      '<div class="kpi-top"><span class="kpi-label">' + opts.label + '</span>' +
      '<span class="kpi-icon kpi-icon--' + opts.tone + '">' + icon(opts.icon) + '</span></div>' +
      '<p class="kpi-value">' + opts.value + '</p>' +
      '<div class="kpi-foot">' + opts.foot + '</div>' +
      '</article>';
  }

  function niceCeil(value) {
    const safe = value > 0 ? value : 1;
    const mag = Math.pow(10, Math.floor(Math.log10(safe)));
    const norm = safe / mag;
    const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
    return step * mag;
  }

  function revenueChart(series, width) {
    width = Math.max(260, Math.round(width || 720));
    const height = width < 460 ? 200 : 248;
    const padL = width < 460 ? 42 : 54;
    const padR = 8;
    const padT = 16;
    const padB = width < 460 ? 30 : 34;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;
    const rawMax = Math.max.apply(null, series.map(function (m) { return m.total; }).concat([1]));
    const max = niceCeil(rawMax * 1.12);
    const slot = plotW / series.length;
    const barW = Math.min(56, slot * 0.5);

    let grid = '';
    for (let i = 0; i <= 4; i++) {
      const y = padT + plotH - (plotH * i / 4);
      grid += '<line x1="' + padL + '" x2="' + (width - padR) + '" y1="' + y + '" y2="' + y + '" class="chart-grid' + (i === 0 ? ' chart-grid--base' : '') + '"/>' +
        '<text x="' + (padL - 12) + '" y="' + (y + 4) + '" text-anchor="end" class="chart-axis">' + fmt.compactMoney(max * i / 4) + '</text>';
    }

    const bars = series.map(function (month, i) {
      const x = padL + slot * i + slot / 2;
      const barH = Math.max(month.total ? 8 : 2, (month.total / max) * plotH);
      const y = padT + plotH - barH;
      const last = i === series.length - 1;
      return '<g class="chart-bar' + (last ? ' is-current' : '') + '">' +
        '<title>' + month.label + ': ' + fmt.money(month.total) + '</title>' +
        '<rect x="' + (x - barW / 2) + '" y="' + y + '" width="' + barW + '" height="' + barH + '" rx="6"/>' +
        '<text x="' + x + '" y="' + (height - 10) + '" text-anchor="middle" class="chart-label' + (last ? ' is-current' : '') + '">' + month.label + '</text>' +
        '</g>';
    }).join('');

    const summary = series.map(function (m) { return m.label + ' ' + fmt.money(m.total); }).join(', ');
    return '<svg class="revenue-chart" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Monthly revenue. ' + esc(summary) + '">' +
      grid + bars + '</svg>';
  }

  function statusBreakdown(s) {
    const rows = store.STATUSES.map(function (status) {
      const data = s.statusCounts[status.id] || { count: 0, value: 0 };
      return { id: status.id, label: status.label, count: data.count, value: data.value };
    });
    const total = rows.reduce(function (sum, row) { return sum + row.count; }, 0);
    if (!total) {
      return '<div class="mini-empty mini-empty--center">' + icon('receipt') + '<p>No orders yet</p><span>Status insights appear once orders are created.</span></div>';
    }
    const colors = {
      pending: 'var(--st-pending)',
      paid: 'var(--st-paid)',
      shipped: 'var(--st-shipped)',
      cancelled: 'var(--st-cancelled)'
    };
    let acc = 0;
    const stops = [];
    rows.forEach(function (row) {
      if (!row.count) return;
      const from = acc / total * 100;
      acc += row.count;
      const to = acc / total * 100;
      stops.push(colors[row.id] + ' ' + from.toFixed(2) + '% ' + to.toFixed(2) + '%');
    });
    return '<div class="donut-layout">' +
      '<div class="donut" style="background:conic-gradient(' + stops.join(',') + ')" role="img" aria-label="Order status split: ' +
      esc(rows.map(function (r) { return r.label + ' ' + r.count; }).join(', ')) + '">' +
      '<div class="donut-hole"><strong>' + fmt.number(total) + '</strong><span>orders</span></div></div>' +
      '<ul class="legend">' + rows.map(function (row) {
        return '<li><span class="legend-dot" style="background:' + colors[row.id] + '"></span>' +
          '<span class="legend-label">' + row.label + '</span>' +
          '<span class="legend-count">' + fmt.number(row.count) + '</span>' +
          '<span class="legend-pct">' + Math.round(row.count / total * 100) + '%</span></li>';
      }).join('') + '</ul></div>';
  }

  function recentOrdersTable(orders) {
    if (!orders.length) {
      return emptyState('receipt', 'No orders yet', 'Create your first order to see activity here.',
        '<button type="button" class="btn btn-primary" data-action="new-order">' + icon('plus') + 'New order</button>');
    }
    return '<div class="table-wrap"><table class="table table--compact">' +
      '<caption class="sr-only">Recent orders</caption>' +
      '<thead><tr><th scope="col">Order</th><th scope="col">Client</th><th scope="col">Status</th><th scope="col" class="ta-right">Total</th></tr></thead><tbody>' +
      orders.map(function (order) {
        const client = store.getClient(order.clientId);
        return '<tr data-action="edit-order" data-id="' + order.id + '" tabindex="0">' +
          '<td data-label="Order" class="cell-primary"><span class="cell-title">' + esc(order.number) + '</span><span class="cell-sub">' + esc(fmt.shortDate(order.date)) + '</span></td>' +
          '<td data-label="Client"><span class="cell-title cell-title--sm">' + esc(clientName(client)) + '</span><span class="cell-sub">' + esc(client ? client.city : '—') + '</span></td>' +
          '<td data-label="Status">' + statusPill(order.status) + '</td>' +
          '<td data-label="Total" class="ta-right cell-num"><strong>' + fmt.money(store.orderTotal(order)) + '</strong></td>' +
          '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  function lowStockCard(s) {
    const items = s.lowStock.slice(0, 4);
    return '<section class="card">' +
      '<div class="card-head"><div><h2 class="card-title">Low stock</h2>' +
      '<p class="card-sub">' + (s.lowStockCount ? fmt.plural(s.lowStockCount, 'product') + ' need attention' : 'Inventory looks healthy') + '</p></div>' +
      '<button type="button" class="text-link" data-action="filter-low-stock">Review ' + icon('arrow-right') + '</button></div>' +
      '<div class="card-body list-body">' +
      (items.length ? items.map(function (product) {
        const state = stockState(product);
        return '<button type="button" class="mini-row" data-action="edit-product" data-id="' + product.id + '">' +
          '<span class="mini-thumb mini-thumb--' + state + '" aria-hidden="true">' + esc(product.name.charAt(0)) + '</span>' +
          '<span class="mini-copy"><strong>' + esc(product.name) + '</strong><small>' + esc(product.sku) + ' · reorder at ' + product.reorder + '</small></span>' +
          '<span class="mini-meta">' + stockPill(product) + '<small>' + product.stock + ' left</small></span>' +
          '</button>';
      }).join('') : '<div class="mini-empty mini-empty--center">' + icon('check') + '<p>Everything is stocked</p><span>No products are below their reorder point.</span></div>') +
      '</div></section>';
  }

  function topProductsCard(s) {
    const maxUnits = s.topProducts.length ? s.topProducts[0].units : 1;
    return '<section class="card">' +
      '<div class="card-head"><div><h2 class="card-title">Top products</h2><p class="card-sub">By units sold · all time</p></div>' +
      '<span class="chip chip--quiet">' + icon('sparkles') + 'Best sellers</span></div>' +
      '<div class="card-body list-body">' +
      (s.topProducts.length ? s.topProducts.map(function (row, i) {
        return '<div class="rank-row">' +
          '<span class="rank">' + (i + 1) + '</span>' +
          '<div class="rank-copy"><div class="rank-line"><strong>' + esc(row.product.name) + '</strong><span>' + fmt.plural(row.units, 'unit') + '</span></div>' +
          '<div class="rank-bar" aria-hidden="true"><i style="width:' + Math.max(4, row.units / maxUnits * 100) + '%"></i></div></div>' +
          '<span class="rank-value">' + fmt.moneyShort(row.revenue) + '</span></div>';
      }).join('') : '<div class="mini-empty mini-empty--center">' + icon('box') + '<p>No sales yet</p><span>Top sellers will appear after your first order.</span></div>') +
      '</div></section>';
  }

  function renderDashboard() {
    const s = store.stats();
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const chartTotal = s.series.reduce(function (sum, m) { return sum + m.total; }, 0);

    return pageHead(
      '<span class="live-dot" aria-hidden="true"></span>Live workspace',
      greeting + ', Sofia',
      'Here’s how GestCom is performing right now.',
      '<span class="date-chip">' + icon('calendar') + esc(fmt.date(todayISO())) + '</span>'
    ) +
      '<div class="kpis">' +
      kpiCard({
        label: 'Revenue', tone: 'brand', icon: 'trending-up',
        value: fmt.moneyShort(s.revenue30),
        foot: deltaTag(s.revenueDelta) + '<span>vs previous 30 days</span>'
      }) +
      kpiCard({
        label: 'Orders', tone: 'info', icon: 'receipt',
        value: fmt.number(s.orders30),
        foot: deltaTag(s.ordersDelta) + '<span>vs previous 30 days</span>'
      }) +
      kpiCard({
        label: 'Clients', tone: 'violet', icon: 'users',
        value: fmt.number(s.totalClients),
        foot: (s.newClients30 ? '<span class="kpi-note kpi-note--good">+' + s.newClients30 + ' new</span>' : '<span class="kpi-note">No new clients</span>') + '<span>in the last 30 days</span>'
      }) +
      kpiCard({
        label: 'Low stock', tone: 'warn', icon: 'alert', warn: s.lowStockCount > 0,
        value: fmt.number(s.lowStockCount),
        foot: '<button type="button" class="kpi-link" data-action="filter-low-stock">' + (s.outOfStock ? s.outOfStock + ' out of stock' : 'Review inventory') + ' ' + icon('arrow-right') + '</button>'
      }) +
      '</div>' +
      '<div class="dash-grid dash-grid--primary">' +
      '<section class="card">' +
      '<div class="card-head"><div><h2 class="card-title">Revenue</h2><p class="card-sub">Orders across the last 6 months</p></div>' +
      '<div class="chart-total"><span>6-month total</span><strong>' + fmt.moneyShort(chartTotal) + '</strong></div></div>' +
      '<div class="card-body chart-body" data-chart>' + revenueChart(s.series) + '</div>' +
      '</section>' +
      '<section class="card">' +
      '<div class="card-head"><div><h2 class="card-title">Order status</h2><p class="card-sub">All time · ' + fmt.plural(s.totalOrders, 'order') + '</p></div>' +
      '<span class="chip chip--quiet">' + fmt.moneyShort(s.avgOrder) + ' avg order</span></div>' +
      '<div class="card-body">' + statusBreakdown(s) + '</div>' +
      '</section>' +
      '</div>' +
      '<div class="dash-grid dash-grid--secondary">' +
      '<section class="card">' +
      '<div class="card-head"><div><h2 class="card-title">Recent orders</h2><p class="card-sub">Latest activity across the store</p></div>' +
      '<a class="text-link" href="#/orders">View all ' + icon('arrow-right') + '</a></div>' +
      recentOrdersTable(s.recentOrders) +
      '</section>' +
      '<div class="dash-stack">' + lowStockCard(s) + topProductsCard(s) + '</div>' +
      '</div>';
  }

  /* -------------------------------- orders ------------------------------ */

  function filteredOrders() {
    const query = ui.orderSearch.trim().toLowerCase();
    let rows = store.getOrders().map(function (order) {
      return {
        order: order,
        client: store.getClient(order.clientId),
        total: store.orderTotal(order),
        units: store.orderUnits(order),
        lines: order.items.length
      };
    });

    if (query) {
      rows = rows.filter(function (row) {
        return [row.order.number, clientName(row.client), row.order.date, row.order.status]
          .join(' ').toLowerCase().indexOf(query) !== -1;
      });
    }
    if (ui.orderStatus !== 'all') {
      rows = rows.filter(function (row) { return row.order.status === ui.orderStatus; });
    }

    const byDate = function (a, b) {
      return String(a.order.date).localeCompare(String(b.order.date)) || String(a.order.number).localeCompare(String(b.order.number));
    };
    const sorts = {
      newest: function (a, b) { return byDate(b, a); },
      oldest: byDate,
      highest: function (a, b) { return b.total - a.total; },
      lowest: function (a, b) { return a.total - b.total; },
      client: function (a, b) { return clientName(a.client).localeCompare(clientName(b.client)); }
    };
    rows.sort(sorts[ui.orderSort] || sorts.newest);
    return rows;
  }

  function renderOrders() {
    const rows = filteredOrders();
    const all = store.getOrders();
    const filteredValue = rows.reduce(function (sum, row) {
      return row.order.status === 'cancelled' ? sum : sum + row.total;
    }, 0);

    const statusOptions = '<option value="all">All statuses</option>' + store.STATUSES.map(function (status) {
      return '<option value="' + status.id + '"' + (ui.orderStatus === status.id ? ' selected' : '') + '>' + status.label + '</option>';
    }).join('');

    const table = rows.length ? '<div class="table-wrap"><table class="table">' +
      '<caption class="sr-only">Orders</caption>' +
      '<thead><tr><th scope="col">Order</th><th scope="col">Client</th><th scope="col">Items</th><th scope="col">Status</th><th scope="col" class="ta-right">Total</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>' +
      rows.map(function (row) {
        const order = row.order;
        return '<tr class="row-link" data-action="edit-order" data-id="' + order.id + '" tabindex="0">' +
          '<td class="cell-primary" data-label="Order"><span class="cell-title">' + esc(order.number) + '</span><span class="cell-sub">' + esc(fmt.date(order.date)) + '</span></td>' +
          '<td data-label="Client">' + personCell(row.client) + '</td>' +
          '<td data-label="Items"><span class="cell-title cell-title--sm">' + row.units + ' units</span><span class="cell-sub">' + fmt.plural(row.lines, 'product') + '</span></td>' +
          '<td data-label="Status">' + statusPill(order.status) + '</td>' +
          '<td data-label="Total" class="ta-right cell-num"><strong>' + fmt.money(row.total) + '</strong></td>' +
          '<td class="cell-actions" data-label=""><div class="row-actions">' +
          '<button type="button" class="icon-btn" data-action="edit-order" data-id="' + order.id + '" aria-label="Edit ' + esc(order.number) + '" title="Edit order">' + icon('edit') + '</button>' +
          '<button type="button" class="icon-btn icon-btn--danger" data-action="delete-order" data-id="' + order.id + '" aria-label="Delete ' + esc(order.number) + '" title="Delete order">' + icon('trash') + '</button>' +
          '</div></td></tr>';
      }).join('') + '</tbody></table></div>' :
      (all.length ?
        emptyState('search', 'No matching orders', 'Try a different search or status filter.',
          '<button type="button" class="btn" data-action="clear-order-filters">Clear filters</button>') :
        emptyState('receipt', 'No orders yet', 'Create your first order and it will show up here.',
          '<button type="button" class="btn btn-primary" data-action="new-order">' + icon('plus') + 'Create order</button>'));

    return pageHead('Sales', 'Orders', 'Every purchase, from pending payment to shipped.',
      '<button type="button" class="btn btn-primary" data-action="new-order">' + icon('plus') + 'New order</button>') +
      '<section class="card">' +
      '<div class="toolbar">' +
      '<div class="search-field"><svg class="icon" aria-hidden="true"><use href="#i-search"/></svg>' +
      '<input id="order-search" type="search" value="' + esc(ui.orderSearch) + '" placeholder="Search by order or client…" aria-label="Search orders" autocomplete="off"></div>' +
      '<select class="select" id="order-status-filter" aria-label="Filter by status">' + statusOptions + '</select>' +
      '<select class="select" id="order-sort" aria-label="Sort orders">' +
      '<option value="newest"' + (ui.orderSort === 'newest' ? ' selected' : '') + '>Newest first</option>' +
      '<option value="oldest"' + (ui.orderSort === 'oldest' ? ' selected' : '') + '>Oldest first</option>' +
      '<option value="highest"' + (ui.orderSort === 'highest' ? ' selected' : '') + '>Highest total</option>' +
      '<option value="lowest"' + (ui.orderSort === 'lowest' ? ' selected' : '') + '>Lowest total</option>' +
      '<option value="client"' + (ui.orderSort === 'client' ? ' selected' : '') + '>Client A–Z</option>' +
      '</select>' +
      '<button type="button" class="btn btn-ghost toolbar-print" data-action="print-orders">' + icon('printer') + '<span>Print</span></button>' +
      '</div>' +
      (all.length ? '<div class="list-meta"><span>Showing <strong>' + rows.length + '</strong> of ' + all.length + ' orders</span><span>Filtered value <strong>' + fmt.moneyShort(filteredValue) + '</strong></span></div>' : '') +
      table + '</section>';
  }

  /* -------------------------------- clients ----------------------------- */

  function filteredClients() {
    const query = ui.clientSearch.trim().toLowerCase();
    let rows = store.getClients().map(function (client) {
      return { client: client, summary: store.clientSummary(client.id) };
    });
    if (query) {
      rows = rows.filter(function (row) {
        return [clientName(row.client), row.client.email, row.client.city, row.client.phone]
          .join(' ').toLowerCase().indexOf(query) !== -1;
      });
    }
    const sorts = {
      name: function (a, b) { return clientName(a.client).localeCompare(clientName(b.client)); },
      newest: function (a, b) { return new Date(b.client.createdAt) - new Date(a.client.createdAt); },
      value: function (a, b) { return b.summary.value - a.summary.value; },
      orders: function (a, b) { return b.summary.orders - a.summary.orders; }
    };
    rows.sort(sorts[ui.clientSort] || sorts.name);
    return rows;
  }

  function renderClients() {
    const rows = filteredClients();
    const all = store.getClients();
    const totalValue = rows.reduce(function (sum, row) { return sum + row.summary.value; }, 0);

    const table = rows.length ? '<div class="table-wrap"><table class="table">' +
      '<caption class="sr-only">Clients</caption>' +
      '<thead><tr><th scope="col">Client</th><th scope="col">City</th><th scope="col">Orders</th><th scope="col" class="ta-right">Lifetime value</th><th scope="col">Customer since</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>' +
      rows.map(function (row) {
        const client = row.client;
        const name = clientName(client);
        return '<tr class="row-link" data-action="edit-client" data-id="' + client.id + '" tabindex="0">' +
          '<td class="cell-primary" data-label="Client"><div class="person">' +
          '<span class="avatar avatar--' + avatarTone(name) + '" aria-hidden="true">' + esc(fmt.initials(client.firstName, client.lastName)) + '</span>' +
          '<div class="person-text"><span class="cell-title">' + esc(name) + '</span><span class="cell-sub">' + esc(client.email || 'No email') + '</span></div></div></td>' +
          '<td data-label="City">' + esc(client.city || '—') + '</td>' +
          '<td data-label="Orders"><span class="cell-title cell-title--sm">' + row.summary.orders + '</span><span class="cell-sub">' + (row.summary.lastOrder ? 'Last ' + esc(fmt.shortDate(row.summary.lastOrder)) : 'No orders yet') + '</span></td>' +
          '<td data-label="Lifetime value" class="ta-right cell-num"><strong>' + fmt.money(row.summary.value) + '</strong></td>' +
          '<td data-label="Customer since" class="cell-muted">' + esc(fmt.date(client.createdAt)) + '</td>' +
          '<td class="cell-actions" data-label=""><div class="row-actions">' +
          '<button type="button" class="icon-btn" data-action="edit-client" data-id="' + client.id + '" aria-label="Edit ' + esc(name) + '" title="Edit client">' + icon('edit') + '</button>' +
          '<button type="button" class="icon-btn icon-btn--danger" data-action="delete-client" data-id="' + client.id + '" aria-label="Delete ' + esc(name) + '" title="Delete client">' + icon('trash') + '</button>' +
          '</div></td></tr>';
      }).join('') + '</tbody></table></div>' :
      (all.length ?
        emptyState('search', 'No matching clients', 'Try a name, city, email, or phone number.',
          '<button type="button" class="btn" data-action="clear-client-filters">Clear filters</button>') :
        emptyState('users', 'No clients yet', 'Add a client before creating their first order.',
          '<button type="button" class="btn btn-primary" data-action="new-client">' + icon('plus') + 'Add client</button>'));

    return pageHead('Relationships', 'Clients', 'Your customers, their cities, and the value they bring.',
      '<button type="button" class="btn btn-primary" data-action="new-client">' + icon('plus') + 'Add client</button>') +
      '<section class="card">' +
      '<div class="toolbar">' +
      '<div class="search-field"><svg class="icon" aria-hidden="true"><use href="#i-search"/></svg>' +
      '<input id="client-search" type="search" value="' + esc(ui.clientSearch) + '" placeholder="Search name, city, email…" aria-label="Search clients" autocomplete="off"></div>' +
      '<select class="select" id="client-sort" aria-label="Sort clients">' +
      '<option value="name"' + (ui.clientSort === 'name' ? ' selected' : '') + '>Name A–Z</option>' +
      '<option value="newest"' + (ui.clientSort === 'newest' ? ' selected' : '') + '>Newest first</option>' +
      '<option value="value"' + (ui.clientSort === 'value' ? ' selected' : '') + '>Highest value</option>' +
      '<option value="orders"' + (ui.clientSort === 'orders' ? ' selected' : '') + '>Most orders</option>' +
      '</select>' +
      '</div>' +
      (all.length ? '<div class="list-meta"><span>Showing <strong>' + rows.length + '</strong> of ' + all.length + ' clients</span><span>Combined value <strong>' + fmt.moneyShort(totalValue) + '</strong></span></div>' : '') +
      table + '</section>';
  }

  /* ------------------------------- products ----------------------------- */

  function stockMeter(product) {
    const state = stockState(product);
    const target = Math.max(product.reorder * 3, 1);
    const pct = Math.min(100, Math.round(product.stock / target * 100));
    return '<div class="stock-cell"><span class="stock-number">' + product.stock + '</span>' +
      '<span class="meter meter--' + state + '" aria-hidden="true"><i style="width:' + Math.max(2, pct) + '%"></i></span></div>';
  }

  function filteredProducts() {
    const query = ui.productSearch.trim().toLowerCase();
    let rows = store.getProducts();
    if (query) {
      rows = rows.filter(function (product) {
        return [product.name, product.sku, product.category].join(' ').toLowerCase().indexOf(query) !== -1;
      });
    }
    if (ui.productCategory !== 'all') {
      rows = rows.filter(function (product) { return product.category === ui.productCategory; });
    }
    if (ui.productStock === 'low') {
      rows = rows.filter(function (product) { return product.stock <= product.reorder; });
    }
    if (ui.productStock === 'out') {
      rows = rows.filter(function (product) { return product.stock === 0; });
    }
    const sorts = {
      name: function (a, b) { return a.name.localeCompare(b.name); },
      'price-desc': function (a, b) { return b.price - a.price; },
      'price-asc': function (a, b) { return a.price - b.price; },
      'stock-asc': function (a, b) { return a.stock - b.stock; },
      'stock-desc': function (a, b) { return b.stock - a.stock; }
    };
    rows.sort(sorts[ui.productSort] || sorts.name);
    return rows;
  }

  function renderProducts() {
    const rows = filteredProducts();
    const all = store.getProducts();
    const inventoryValue = rows.reduce(function (sum, product) { return sum + product.price * product.stock; }, 0);

    const catOptions = '<option value="all">All categories</option>' + store.CATEGORIES.map(function (category) {
      return '<option value="' + category + '"' + (ui.productCategory === category ? ' selected' : '') + '>' + category + '</option>';
    }).join('');

    const table = rows.length ? '<div class="table-wrap"><table class="table">' +
      '<caption class="sr-only">Products</caption>' +
      '<thead><tr><th scope="col">Product</th><th scope="col">Category</th><th scope="col" class="ta-right">Price</th><th scope="col">Stock</th><th scope="col">Status</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>' +
      rows.map(function (product) {
        return '<tr class="row-link" data-action="edit-product" data-id="' + product.id + '" tabindex="0">' +
          '<td class="cell-primary" data-label="Product"><div class="person"><span class="product-thumb" aria-hidden="true">' + esc(product.name.charAt(0)) + '</span>' +
          '<div class="person-text"><span class="cell-title">' + esc(product.name) + '</span><span class="cell-sub">' + esc(product.sku) + '</span></div></div></td>' +
          '<td data-label="Category"><span class="chip chip--quiet">' + esc(product.category) + '</span></td>' +
          '<td data-label="Price" class="ta-right cell-num"><strong>' + fmt.money(product.price) + '</strong></td>' +
          '<td data-label="Stock">' + stockMeter(product) + '</td>' +
          '<td data-label="Status">' + stockPill(product) + '</td>' +
          '<td class="cell-actions" data-label=""><div class="row-actions">' +
          '<button type="button" class="icon-btn" data-action="edit-product" data-id="' + product.id + '" aria-label="Edit ' + esc(product.name) + '" title="Edit product">' + icon('edit') + '</button>' +
          '<button type="button" class="icon-btn icon-btn--danger" data-action="delete-product" data-id="' + product.id + '" aria-label="Delete ' + esc(product.name) + '" title="Delete product">' + icon('trash') + '</button>' +
          '</div></td></tr>';
      }).join('') + '</tbody></table></div>' :
      (all.length ?
        emptyState('search', 'No matching products', 'Try a different search, category, or stock filter.',
          '<button type="button" class="btn" data-action="clear-product-filters">Clear filters</button>') :
        emptyState('box', 'No products yet', 'Add products so you can start building orders.',
          '<button type="button" class="btn btn-primary" data-action="new-product">' + icon('plus') + 'Add product</button>'));

    return pageHead('Inventory', 'Products', 'Prices, stock levels, and reorder points in one place.',
      '<button type="button" class="btn btn-primary" data-action="new-product">' + icon('plus') + 'Add product</button>') +
      '<section class="card">' +
      '<div class="toolbar">' +
      '<div class="search-field"><svg class="icon" aria-hidden="true"><use href="#i-search"/></svg>' +
      '<input id="product-search" type="search" value="' + esc(ui.productSearch) + '" placeholder="Search products or SKUs…" aria-label="Search products" autocomplete="off"></div>' +
      '<select class="select" id="product-category" aria-label="Filter by category">' + catOptions + '</select>' +
      '<select class="select" id="product-stock" aria-label="Filter by stock">' +
      '<option value="all"' + (ui.productStock === 'all' ? ' selected' : '') + '>All stock</option>' +
      '<option value="low"' + (ui.productStock === 'low' ? ' selected' : '') + '>Needs restock</option>' +
      '<option value="out"' + (ui.productStock === 'out' ? ' selected' : '') + '>Out of stock</option>' +
      '</select>' +
      '<select class="select" id="product-sort" aria-label="Sort products">' +
      '<option value="name"' + (ui.productSort === 'name' ? ' selected' : '') + '>Name A–Z</option>' +
      '<option value="price-desc"' + (ui.productSort === 'price-desc' ? ' selected' : '') + '>Price high to low</option>' +
      '<option value="price-asc"' + (ui.productSort === 'price-asc' ? ' selected' : '') + '>Price low to high</option>' +
      '<option value="stock-asc"' + (ui.productSort === 'stock-asc' ? ' selected' : '') + '>Stock low to high</option>' +
      '<option value="stock-desc"' + (ui.productSort === 'stock-desc' ? ' selected' : '') + '>Stock high to low</option>' +
      '</select>' +
      '</div>' +
      (all.length ? '<div class="list-meta"><span>Showing <strong>' + rows.length + '</strong> of ' + all.length + ' products</span><span>Inventory value <strong>' + fmt.moneyShort(inventoryValue) + '</strong></span></div>' : '') +
      table + '</section>';
  }

  /* --------------------------------- data ------------------------------- */

  function formatDateTime(iso) {
    const date = new Date(iso);
    if (isNaN(date.getTime())) return '—';
    return date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function renderData() {
    const info = store.storageInfo();
    const state = store.getState();
    const settings = store.getSettings();
    const themeValue = settings.theme || 'system';
    const counts = {
      clients: state.clients.length,
      products: state.products.length,
      orders: state.orders.length
    };

    return pageHead('Manage', 'Data & backups', 'Everything lives in this browser. Export a copy before you clear site data.',
      '<span class="chip ' + (info.demo ? 'chip--warn' : 'chip--ok') + '">' + (info.demo ? 'Sample workspace' : 'Your workspace') + '</span>') +
      '<div class="data-grid">' +
      '<section class="card">' +
      '<div class="card-head"><div><h2 class="card-title">Workspace snapshot</h2><p class="card-sub">What is stored on this device</p></div><span class="kpi-icon kpi-icon--brand">' + icon('database') + '</span></div>' +
      '<div class="card-body"><dl class="stat-list">' +
      '<div><dt>Clients</dt><dd>' + fmt.number(counts.clients) + '</dd></div>' +
      '<div><dt>Products</dt><dd>' + fmt.number(counts.products) + '</dd></div>' +
      '<div><dt>Orders</dt><dd>' + fmt.number(counts.orders) + '</dd></div>' +
      '<div><dt>Order value</dt><dd>' + fmt.moneyShort(state.orders.reduce(function (sum, order) { return order.status === 'cancelled' ? sum : sum + store.orderTotal(order); }, 0)) + '</dd></div>' +
      '</dl><p class="fine-print">Last saved ' + esc(formatDateTime(info.updatedAt)) + '</p></div>' +
      '</section>' +
      '<section class="card">' +
      '<div class="card-head"><div><h2 class="card-title">Local storage</h2><p class="card-sub">Browser storage used by GestCom</p></div><span class="chip">' + Math.max(1, Math.round(info.percent)) + '% of 5 MB</span></div>' +
      '<div class="card-body"><div class="usage-bar usage-bar--lg" aria-hidden="true"><span style="width:' + Math.max(2, info.percent) + '%"></span></div>' +
      '<p class="storage-line"><strong>' + formatBytes(info.bytes) + '</strong> used</p>' +
      '<p class="fine-print">Clearing your browser’s site data removes this workspace. Keep a JSON backup somewhere safe.</p></div>' +
      '</section>' +
      '<section class="card">' +
      '<div class="card-head"><div><h2 class="card-title">Export</h2><p class="card-sub">Take your data with you</p></div><span class="kpi-icon kpi-icon--violet">' + icon('download') + '</span></div>' +
      '<div class="card-body"><p class="card-text">Download a full JSON backup, or grab individual tables as CSV for spreadsheets.</p>' +
      '<div class="button-row"><button type="button" class="btn btn-primary" data-action="export-json">' + icon('download') + 'JSON backup</button></div>' +
      '<div class="button-row button-row--wrap"><button type="button" class="btn btn-sm" data-action="export-csv" data-entity="clients">clients.csv</button>' +
      '<button type="button" class="btn btn-sm" data-action="export-csv" data-entity="products">products.csv</button>' +
      '<button type="button" class="btn btn-sm" data-action="export-csv" data-entity="orders">orders.csv</button></div></div>' +
      '</section>' +
      '<section class="card">' +
      '<div class="card-head"><div><h2 class="card-title">Import</h2><p class="card-sub">Restore a GestCom backup</p></div><span class="kpi-icon kpi-icon--info">' + icon('upload') + '</span></div>' +
      '<div class="card-body"><label class="dropzone" id="dropzone" for="import-file">' +
      '<input type="file" id="import-file" accept=".json,application/json" hidden>' +
      '<span class="dropzone-icon">' + icon('upload') + '</span>' +
      '<strong>Drop a backup here</strong>' +
      '<span>or <span class="link">browse for a .json file</span></span>' +
      '<small>Importing replaces the current workspace.</small>' +
      '</label></div>' +
      '</section>' +
      '<section class="card">' +
      '<div class="card-head"><div><h2 class="card-title">Appearance</h2><p class="card-sub">Choose how GestCom looks</p></div><span class="kpi-icon kpi-icon--violet">' + icon('sun') + '</span></div>' +
      '<div class="card-body"><div class="segmented" role="group" aria-label="Theme">' +
      '<button type="button" class="segmented-btn' + (themeValue === 'system' ? ' is-active' : '') + '" data-action="set-theme" data-theme-value="system" aria-pressed="' + (themeValue === 'system') + '">System</button>' +
      '<button type="button" class="segmented-btn' + (themeValue === 'light' ? ' is-active' : '') + '" data-action="set-theme" data-theme-value="light" aria-pressed="' + (themeValue === 'light') + '">Light</button>' +
      '<button type="button" class="segmented-btn' + (themeValue === 'dark' ? ' is-active' : '') + '" data-action="set-theme" data-theme-value="dark" aria-pressed="' + (themeValue === 'dark') + '">Dark</button>' +
      '</div><p class="fine-print">Your choice is stored with the workspace and remembered on this device.</p></div>' +
      '</section>' +
      '<section class="card card--danger">' +
      '<div class="card-head"><div><h2 class="card-title">Danger zone</h2><p class="card-sub">These actions cannot be undone</p></div><span class="kpi-icon kpi-icon--danger">' + icon('alert') + '</span></div>' +
      '<div class="card-body danger-list">' +
      '<div class="danger-row"><div><strong>Reset to sample data</strong><p>Replace the current workspace with the original demo clients, products, and orders.</p></div><button type="button" class="btn" data-action="reset-demo">Reset demo</button></div>' +
      '<div class="danger-row"><div><strong>Clear workspace</strong><p>Delete every client, product, and order from this browser.</p></div><button type="button" class="btn btn-danger-ghost" data-action="clear-data">Clear everything</button></div>' +
      '</div></section>' +
      '</div>';
  }

  /* -------------------------------- dialogs ----------------------------- */

  function fieldHTML(opts) {
    const id = 'f-' + opts.name;
    const attrs = ['id="' + id + '"', 'name="' + opts.name + '"', 'class="input"', 'type="' + (opts.type || 'text') + '"'];
    if (opts.required) attrs.push('required');
    if (opts.autofocus) attrs.push('autofocus');
    if (opts.placeholder) attrs.push('placeholder="' + esc(opts.placeholder) + '"');
    if (opts.min != null) attrs.push('min="' + opts.min + '"');
    if (opts.max != null) attrs.push('max="' + opts.max + '"');
    if (opts.step != null) attrs.push('step="' + opts.step + '"');
    if (opts.autocomplete) attrs.push('autocomplete="' + opts.autocomplete + '"');
    return '<label class="field ' + (opts.full ? 'field--full' : '') + '" for="' + id + '">' +
      '<span class="field-label">' + esc(opts.label) + (opts.required ? ' <span class="req" aria-hidden="true">*</span>' : '') + '</span>' +
      '<input ' + attrs.join(' ') + ' value="' + esc(opts.value == null ? '' : opts.value) + '">' +
      (opts.hint ? '<span class="field-hint">' + esc(opts.hint) + '</span>' : '') +
      '<span class="field-error" data-error-for="' + opts.name + '"></span></label>';
  }

  function selectHTML(opts) {
    const id = 'f-' + opts.name;
    const options = opts.options.map(function (option) {
      const value = typeof option === 'string' ? option : option.value;
      const label = typeof option === 'string' ? option : option.label;
      return '<option value="' + esc(value) + '"' + (String(opts.value) === String(value) ? ' selected' : '') + '>' + esc(label) + '</option>';
    }).join('');
    return '<label class="field ' + (opts.full ? 'field--full' : '') + '" for="' + id + '">' +
      '<span class="field-label">' + esc(opts.label) + (opts.required ? ' <span class="req" aria-hidden="true">*</span>' : '') + '</span>' +
      '<select class="select" id="' + id + '" name="' + opts.name + '"' + (opts.required ? ' required' : '') + (opts.autofocus ? ' autofocus' : '') + '>' +
      (opts.placeholder ? '<option value="">' + esc(opts.placeholder) + '</option>' : '') + options + '</select>' +
      (opts.hint ? '<span class="field-hint">' + esc(opts.hint) + '</span>' : '') +
      '<span class="field-error" data-error-for="' + opts.name + '"></span></label>';
  }

  function dialogHeader(title, subtitle) {
    return '<header class="dialog-head"><div class="dialog-head-copy">' +
      '<h2 class="dialog-title" id="modal-title">' + esc(title) + '</h2>' +
      '<p class="dialog-sub">' + esc(subtitle) + '</p></div>' +
      '<button type="button" class="icon-btn" data-action="close-modal" aria-label="Close dialog">' + icon('x') + '</button></header>';
  }

  function showDialog(html, opts) {
    lastFocus = document.activeElement;
    modal.className = 'dialog' + (opts && opts.wide ? ' dialog--wide' : '');
    modal.innerHTML = html;
    modal.showModal();
    document.body.classList.add('modal-open');
    const autofocus = modal.querySelector('[autofocus]');
    if (autofocus) {
      try { autofocus.focus(); } catch (err) { /* ignore */ }
    }
  }

  function closeModal() {
    if (modal.open) modal.close();
  }

  function clearErrors(form) {
    $$('.field.is-invalid', form).forEach(function (field) { field.classList.remove('is-invalid'); });
    $$('[aria-invalid]', form).forEach(function (input) { input.removeAttribute('aria-invalid'); });
    $$('.field-error', form).forEach(function (error) { error.textContent = ''; });
  }

  function applyErrors(form, errors) {
    clearErrors(form);
    let firstKey = null;
    Object.keys(errors || {}).forEach(function (key) {
      const input = form.elements[key];
      if (!input) return;
      if (firstKey === null) firstKey = key;
      const field = input.closest('.field');
      if (field) {
        field.classList.add('is-invalid');
        const message = field.querySelector('[data-error-for="' + key + '"]');
        if (message) message.textContent = errors[key];
      }
      input.setAttribute('aria-invalid', 'true');
    });
    if (firstKey && form.elements[firstKey]) form.elements[firstKey].focus();
  }

  function openClientDialog(id) {
    const editing = id ? store.getClient(id) : null;
    if (id && !editing) { toast('That client no longer exists.', 'error'); return; }
    const client = editing || { firstName: '', lastName: '', email: '', phone: '', city: '', gender: '' };

    showDialog('<form id="client-form" novalidate>' +
      dialogHeader(editing ? 'Edit client' : 'New client', editing ? 'Update contact details and location.' : 'Add a customer to your workspace.') +
      '<div class="dialog-body"><div class="form-grid">' +
      fieldHTML({ label: 'First name', name: 'firstName', value: client.firstName, required: true, autofocus: true, autocomplete: 'given-name' }) +
      fieldHTML({ label: 'Last name', name: 'lastName', value: client.lastName, required: true, autocomplete: 'family-name' }) +
      fieldHTML({ label: 'Email', name: 'email', value: client.email, type: 'email', placeholder: 'name@example.com', autocomplete: 'email', hint: 'Optional — used on receipts.' }) +
      fieldHTML({ label: 'Phone', name: 'phone', value: client.phone, type: 'tel', placeholder: '+33 6 00 00 00 00', autocomplete: 'tel' }) +
      fieldHTML({ label: 'City', name: 'city', value: client.city, required: true, autocomplete: 'address-level2' }) +
      selectHTML({
        label: 'Gender', name: 'gender', value: client.gender, placeholder: 'Prefer not to say',
        options: store.GENDERS.map(function (gender) { return { value: gender, label: gender }; })
      }) +
      '</div></div>' +
      '<footer class="dialog-foot"><button type="button" class="btn" data-action="close-modal">Cancel</button>' +
      '<button type="submit" class="btn btn-primary">' + (editing ? 'Save changes' : 'Create client') + '</button></footer>' +
      '</form>');

    const form = $('#client-form', modal);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      const result = editing ? store.updateClient(editing.id, data) : store.createClient(data);
      if (!result.ok) {
        applyErrors(form, result.errors);
        toast('Please check the highlighted fields.', 'error');
        return;
      }
      closeModal();
      refresh();
      toast(editing ? 'Client updated.' : 'Client added.', 'success');
    });
  }

  function openProductDialog(id) {
    const editing = id ? store.getProduct(id) : null;
    if (id && !editing) { toast('That product no longer exists.', 'error'); return; }
    const product = editing || { name: '', sku: '', category: '', price: '', stock: 0, reorder: 5 };

    showDialog('<form id="product-form" novalidate>' +
      dialogHeader(editing ? 'Edit product' : 'New product', editing ? 'Update pricing and inventory levels.' : 'Add an item to your catalog.') +
      '<div class="dialog-body"><div class="form-grid">' +
      fieldHTML({ label: 'Product name', name: 'name', value: product.name, required: true, autofocus: true, full: true, placeholder: 'e.g. Aurora Wireless Headphones' }) +
      fieldHTML({ label: 'SKU', name: 'sku', value: product.sku, required: true, placeholder: 'AUR-HP-01', hint: 'A unique code used across orders.' }) +
      selectHTML({
        label: 'Category', name: 'category', value: product.category, required: true, placeholder: 'Choose a category',
        options: store.CATEGORIES
      }) +
      fieldHTML({ label: 'Price (€)', name: 'price', value: product.price, type: 'number', required: true, min: 0, step: '0.01', placeholder: '0.00' }) +
      fieldHTML({ label: 'Stock on hand', name: 'stock', value: product.stock, type: 'number', required: true, min: 0, step: 1, hint: 'Counted manually — orders do not change this number.' }) +
      fieldHTML({ label: 'Reorder threshold', name: 'reorder', value: product.reorder, type: 'number', required: true, min: 0, step: 1, hint: 'Low-stock alerts start at this level.', full: true }) +
      '</div></div>' +
      '<footer class="dialog-foot"><button type="button" class="btn" data-action="close-modal">Cancel</button>' +
      '<button type="submit" class="btn btn-primary">' + (editing ? 'Save changes' : 'Create product') + '</button></footer>' +
      '</form>');

    const form = $('#product-form', modal);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      const result = editing ? store.updateProduct(editing.id, data) : store.createProduct(data);
      if (!result.ok) {
        applyErrors(form, result.errors);
        toast('Please check the highlighted fields.', 'error');
        return;
      }
      closeModal();
      refresh();
      toast(editing ? 'Product updated.' : 'Product added.', 'success');
    });
  }

  /* ------------------------------ order dialog -------------------------- */

  function orderLineHTML(line) {
    const products = store.getProducts().slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    const options = products.map(function (product) {
      return '<option value="' + product.id + '"' + (product.id === line.productId ? ' selected' : '') + '>' + esc(product.name) + '</option>';
    }).join('');
    const price = Number(line.unitPrice) || 0;
    const qty = Number(line.qty) || 1;
    return '<div class="line" data-line data-price="' + price + '">' +
      '<select class="select line-product" data-line-product aria-label="Product">' + options + '</select>' +
      '<input class="input line-qty" type="number" min="1" max="999" step="1" value="' + qty + '" data-line-qty aria-label="Quantity">' +
      '<span class="line-total">' + fmt.money(price * qty) + '</span>' +
      '<button type="button" class="icon-btn line-remove" data-action="remove-line" aria-label="Remove item">' + icon('x') + '</button>' +
      '</div>';
  }

  function recalcOrderTotals() {
    if (!modal.open) return;
    const lines = $$('[data-line]', modal);
    let total = 0;
    let units = 0;
    lines.forEach(function (line) {
      const qty = Math.max(0, parseInt(line.querySelector('[data-line-qty]').value, 10) || 0);
      const price = Number(line.dataset.price) || 0;
      const lineTotal = qty * price;
      const output = line.querySelector('.line-total');
      if (output) output.textContent = fmt.money(lineTotal);
      total += lineTotal;
      units += qty;
    });
    const totalEl = $('#order-total', modal);
    const countEl = $('#order-unit-count', modal);
    if (totalEl) totalEl.textContent = fmt.money(total);
    if (countEl) countEl.textContent = fmt.itemCount(units);
  }

  function addOrderLine() {
    if (!modal.open) return;
    const linesEl = $('#order-lines', modal);
    const products = store.getProducts();
    if (!linesEl || !products.length) return;
    const first = products[0];
    linesEl.insertAdjacentHTML('beforeend', orderLineHTML({ productId: first.id, qty: 1, unitPrice: first.price }));
    recalcOrderTotals();
    const select = linesEl.lastElementChild.querySelector('select');
    if (select) select.focus();
  }

  function removeOrderLine(button) {
    if (!modal.open) return;
    const lines = $$('[data-line]', modal);
    if (lines.length <= 1) { toast('An order needs at least one item.', 'error'); return; }
    const line = button.closest('[data-line]');
    if (line) line.remove();
    recalcOrderTotals();
  }

  function openOrderDialog(id) {
    const editing = id ? store.getOrder(id) : null;
    if (id && !editing) { toast('That order no longer exists.', 'error'); return; }
    const clients = store.getClients().slice().sort(function (a, b) { return clientName(a).localeCompare(clientName(b)); });
    const products = store.getProducts().slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    if (!clients.length) { toast('Add a client before creating an order.', 'error'); navigate('#/clients'); return; }
    if (!products.length) { toast('Add a product before creating an order.', 'error'); navigate('#/products'); return; }

    const base = editing || {
      clientId: clients[0].id,
      date: todayISO(),
      status: 'pending',
      items: [{ productId: products[0].id, qty: 1, unitPrice: products[0].price }],
      note: ''
    };
    const items = base.items.length ? base.items : [{ productId: products[0].id, qty: 1, unitPrice: products[0].price }];

    const clientOptions = clients.map(function (client) {
      return { value: client.id, label: clientName(client) + (client.city ? ' · ' + client.city : '') };
    });

    showDialog('<form id="order-form" novalidate>' +
      dialogHeader(editing ? 'Edit ' + editing.number : 'New order', editing ? 'Adjust items, client, or status.' : 'Build an order from your product catalog.') +
      '<div class="dialog-body">' +
      '<div class="form-grid">' +
      selectHTML({ label: 'Client', name: 'clientId', value: base.clientId, options: clientOptions, required: true, full: true, autofocus: true }) +
      fieldHTML({ label: 'Order date', name: 'date', value: base.date, type: 'date', required: true, max: todayISO() }) +
      selectHTML({ label: 'Status', name: 'status', value: base.status, required: true, options: store.STATUSES.map(function (s) { return { value: s.id, label: s.label }; }) }) +
      '</div>' +
      '<div class="section-head"><div><h3>Line items</h3><p>Prices are captured from the catalog when added.</p></div>' +
      '<button type="button" class="btn btn-sm" data-action="add-line">' + icon('plus') + 'Add item</button></div>' +
      '<div class="line-head" aria-hidden="true"><span>Product</span><span>Qty</span><span>Total</span><span></span></div>' +
      '<div class="lines" id="order-lines">' + items.map(orderLineHTML).join('') + '</div>' +
      '<div class="form-alert" id="order-error" role="alert" hidden></div>' +
      '<div class="order-summary"><div class="summary-block"><span>Items</span><strong id="order-unit-count">—</strong></div>' +
      '<div class="summary-block summary-block--total"><span>Order total</span><strong id="order-total">€0.00</strong></div></div>' +
      '<label class="field field--full" for="f-note"><span class="field-label">Note <span class="optional">optional</span></span>' +
      '<textarea class="textarea" id="f-note" name="note" rows="2" placeholder="Delivery instructions, gift wrap…">' + esc(base.note) + '</textarea></label>' +
      '</div>' +
      '<footer class="dialog-foot"><button type="button" class="btn" data-action="close-modal">Cancel</button>' +
      '<button type="submit" class="btn btn-primary">' + (editing ? 'Save changes' : 'Create order') + '</button></footer>' +
      '</form>', { wide: true });

    recalcOrderTotals();
    const form = $('#order-form', modal);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form).entries());
      const lineItems = $$('[data-line]', form).map(function (line) {
        return {
          productId: line.querySelector('[data-line-product]').value,
          qty: line.querySelector('[data-line-qty]').value,
          unitPrice: Number(line.dataset.price)
        };
      });
      const payload = {
        clientId: values.clientId,
        date: values.date,
        status: values.status,
        note: values.note,
        items: lineItems
      };
      const result = editing ? store.updateOrder(editing.id, payload) : store.createOrder(payload);
      if (!result.ok) {
        applyErrors(form, result.errors);
        const alert = $('#order-error', form);
        if (alert) {
          if (result.errors.items) { alert.textContent = result.errors.items; alert.hidden = false; }
          else { alert.hidden = true; }
        }
        toast('Please check the highlighted fields.', 'error');
        return;
      }
      closeModal();
      refresh();
      toast(editing ? editing.number + ' updated.' : 'Order ' + result.item.number + ' created.', 'success');
    });
  }

  /* ----------------------------- confirm + toast ------------------------ */

  function confirmAction(opts) {
    return new Promise(function (resolve) {
      const primary = opts.variant === 'primary';
      showDialog('<div class="confirm">' +
        '<div class="dialog-head"><div class="confirm-title">' +
        '<span class="confirm-icon ' + (primary ? 'confirm-icon--brand' : 'confirm-icon--danger') + '">' + icon(opts.icon || (primary ? 'upload' : 'alert')) + '</span>' +
        '<div><h2 class="dialog-title" id="modal-title">' + esc(opts.title) + '</h2>' +
        (opts.subtitle ? '<p class="dialog-sub">' + esc(opts.subtitle) + '</p>' : '') + '</div></div>' +
        '<button type="button" class="icon-btn" data-action="close-modal" aria-label="Close dialog">' + icon('x') + '</button></div>' +
        '<div class="dialog-body"><p class="confirm-text">' + esc(opts.message) + '</p>' +
        (opts.detail ? '<p class="fine-print">' + esc(opts.detail) + '</p>' : '') + '</div>' +
        '<div class="dialog-foot"><button type="button" class="btn" data-action="close-modal">Cancel</button>' +
        '<button type="button" class="btn ' + (primary ? 'btn-primary' : 'btn-danger') + '" data-action="confirm-yes">' + esc(opts.confirmLabel || 'Delete') + '</button></div>' +
        '</div>');

      let settled = false;
      const finish = function (value) {
        if (settled) return;
        settled = true;
        if (modal.open) modal.close();
        resolve(value);
      };
      modal.querySelector('[data-action="confirm-yes"]').addEventListener('click', function () { finish(true); });
      modal.addEventListener('close', function () { if (!settled) { settled = true; resolve(false); } }, { once: true });
    });
  }

  function toast(message, tone) {
    const el = document.createElement('div');
    el.className = 'toast toast--' + (tone || 'success');
    el.innerHTML = '<span class="toast-icon">' + icon(tone === 'error' ? 'alert' : 'check') + '</span><span class="toast-text">' + esc(message) + '</span>';
    toastsEl.appendChild(el);
    window.setTimeout(function () {
      el.classList.add('is-leaving');
      window.setTimeout(function () { el.remove(); }, 220);
    }, 3400);
  }

  /* ------------------------------- deleting ----------------------------- */

  async function deleteOrder(id) {
    const order = store.getOrder(id);
    if (!order) return;
    const ok = await confirmAction({
      title: 'Delete order?',
      subtitle: order.number + ' · ' + fmt.money(store.orderTotal(order)),
      message: 'This order and its line items will be removed permanently.',
      detail: 'Revenue and status totals will update immediately.',
      confirmLabel: 'Delete order'
    });
    if (!ok) return;
    const result = store.deleteOrder(id);
    if (!result.ok) { toast(result.error, 'error'); return; }
    refresh();
    toast(order.number + ' deleted.', 'success');
  }

  async function deleteClient(id) {
    const client = store.getClient(id);
    if (!client) return;
    const count = store.getOrders().filter(function (o) { return o.clientId === id; }).length;
    if (count) {
      toast(clientName(client) + ' has ' + fmt.plural(count, 'order') + '. Delete those orders first.', 'error');
      return;
    }
    const ok = await confirmAction({
      title: 'Delete client?',
      subtitle: clientName(client),
      message: 'This client will be removed from your workspace.',
      detail: 'This action cannot be undone.',
      confirmLabel: 'Delete client'
    });
    if (!ok) return;
    const result = store.deleteClient(id);
    if (!result.ok) { toast(result.error, 'error'); return; }
    refresh();
    toast('Client deleted.', 'success');
  }

  async function deleteProduct(id) {
    const product = store.getProduct(id);
    if (!product) return;
    const count = store.getOrders().filter(function (o) {
      return o.items.some(function (line) { return line.productId === id; });
    }).length;
    if (count) {
      toast(product.name + ' appears in ' + fmt.plural(count, 'order') + '. Remove it from those orders first.', 'error');
      return;
    }
    const ok = await confirmAction({
      title: 'Delete product?',
      subtitle: product.name,
      message: 'This product will be removed from your catalog.',
      detail: 'This action cannot be undone.',
      confirmLabel: 'Delete product'
    });
    if (!ok) return;
    const result = store.deleteProduct(id);
    if (!result.ok) { toast(result.error, 'error'); return; }
    refresh();
    toast('Product deleted.', 'success');
  }

  /* ----------------------------- export / import ------------------------ */

  function downloadFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function exportJSON() {
    const payload = store.exportData();
    downloadFile('gestcom-backup-' + todayISO() + '.json', JSON.stringify(payload, null, 2), 'application/json');
    toast('JSON backup downloaded.', 'success');
  }

  function csvCell(value) {
    const text = String(value == null ? '' : value);
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function exportCSV(entity) {
    const state = store.getState();
    let header;
    let rows;

    if (entity === 'clients') {
      header = ['first_name', 'last_name', 'email', 'phone', 'city', 'gender', 'orders', 'lifetime_value'];
      rows = state.clients.map(function (client) {
        const summary = store.clientSummary(client.id);
        return [client.firstName, client.lastName, client.email, client.phone, client.city, client.gender, summary.orders, summary.value.toFixed(2)];
      });
    } else if (entity === 'products') {
      header = ['sku', 'name', 'category', 'price', 'stock', 'reorder_threshold'];
      rows = state.products.map(function (product) {
        return [product.sku, product.name, product.category, Number(product.price).toFixed(2), product.stock, product.reorder];
      });
    } else if (entity === 'orders') {
      header = ['order', 'date', 'client', 'status', 'items', 'units', 'total'];
      rows = state.orders.map(function (order) {
        const client = store.getClient(order.clientId);
        return [order.number, order.date, clientName(client), order.status, order.items.length, store.orderUnits(order), store.orderTotal(order).toFixed(2)];
      });
    } else {
      return;
    }

    const csv = '\uFEFF' + [header].concat(rows).map(function (row) {
      return row.map(csvCell).join(',');
    }).join('\r\n');
    downloadFile('gestcom-' + entity + '-' + todayISO() + '.csv', csv, 'text/csv;charset=utf-8');
    toast(entity + '.csv downloaded.', 'success');
  }

  async function handleImportFile(file) {
    const input = document.getElementById('import-file');
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      toast('That backup is too large (maximum 4 MB).', 'error');
      if (input) input.value = '';
      return;
    }
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const preview = parsed.data && Array.isArray(parsed.data.clients) ? parsed.data : parsed;
      if (!preview || !Array.isArray(preview.clients) || !Array.isArray(preview.products) || !Array.isArray(preview.orders)) {
        throw new Error('This file is not a GestCom backup.');
      }
      const ok = await confirmAction({
        title: 'Import this backup?',
        subtitle: file.name,
        message: 'Replace the current workspace with ' + fmt.plural(preview.clients.length, 'client') + ', ' +
          fmt.plural(preview.products.length, 'product') + ', and ' + fmt.plural(preview.orders.length, 'order') + '?',
        detail: 'Your current data will be overwritten. Export a backup first if you are unsure.',
        confirmLabel: 'Import & replace',
        variant: 'primary',
        icon: 'upload'
      });
      if (!ok) { if (input) input.value = ''; return; }
      const result = store.importData(parsed);
      if (!result.ok) { toast(result.error, 'error'); if (input) input.value = ''; return; }
      applyTheme();
      refresh();
      toast('Workspace imported successfully.', 'success');
    } catch (err) {
      toast(err.message || 'That file is not valid JSON.', 'error');
    } finally {
      if (input) input.value = '';
    }
  }

  async function resetDemoAction() {
    const ok = await confirmAction({
      title: 'Reset to sample data?',
      message: 'The current workspace will be replaced with the original demo clients, products, and orders.',
      detail: 'Any changes you have made will be lost.',
      confirmLabel: 'Reset data'
    });
    if (!ok) return;
    store.resetDemo();
    refresh();
    toast('Sample workspace restored.', 'success');
  }

  async function clearDataAction() {
    const ok = await confirmAction({
      title: 'Clear the workspace?',
      message: 'Every client, product, and order will be deleted from this browser.',
      detail: 'This cannot be undone. Export a JSON backup first if you need a copy.',
      confirmLabel: 'Clear everything'
    });
    if (!ok) return;
    store.clearAll();
    refresh();
    toast('Workspace cleared.', 'success');
  }


})();
