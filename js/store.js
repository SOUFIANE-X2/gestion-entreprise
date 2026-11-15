/*!
 * GestCom — local-first workspace store
 * No backend, no dependencies. Data persists in localStorage.
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'gestcom.workspace.v1';
  const SCHEMA_VERSION = 1;
  const DAY = 86400000;

  const STATUSES = [
    { id: 'pending', label: 'Pending' },
    { id: 'paid', label: 'Paid' },
    { id: 'shipped', label: 'Shipped' },
    { id: 'cancelled', label: 'Cancelled' }
  ];
  const STATUS_IDS = STATUSES.map(function (s) { return s.id; });
  const CATEGORIES = ['Audio', 'Workspace', 'Lighting', 'Storage', 'Accessories', 'Displays'];
  const GENDERS = ['Female', 'Male', 'Other'];
  const DEFAULT_SETTINGS = { theme: 'system' };

  /* ----------------------------- formatting ----------------------------- */

  const moneyFormat = new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2
  });
  const moneyShortFormat = new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0
  });
  const numberFormat = new Intl.NumberFormat('en-US');
  const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const shortDateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
  const monthFormat = new Intl.DateTimeFormat('en-US', { month: 'short' });

  function parseDate(iso) {
    const parts = String(iso || '').slice(0, 10).split('-').map(Number);
    if (parts.length !== 3 || parts.some(function (n) { return !Number.isFinite(n); })) return new Date(NaN);
    return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0);
  }

  function pad(n) { return String(n).padStart(2, '0'); }
  function isoDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function todayISO() { return isoDate(new Date()); }

  const fmt = {
    money: function (n) { return moneyFormat.format(Number(n) || 0); },
    moneyShort: function (n) { return moneyShortFormat.format(Number(n) || 0); },
    compactMoney: function (n) {
      const v = Number(n) || 0;
      if (Math.abs(v) >= 1000000) return '€' + (v / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
      if (Math.abs(v) >= 1000) return '€' + (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
      return '€' + Math.round(v);
    },
    number: function (n) { return numberFormat.format(Number(n) || 0); },
    date: function (iso) {
      const d = parseDate(iso);
      return Number.isNaN(d.getTime()) ? '—' : dateFormat.format(d);
    },
    shortDate: function (iso) {
      const d = parseDate(iso);
      return Number.isNaN(d.getTime()) ? '—' : shortDateFormat.format(d);
    },
    month: function (date) { return monthFormat.format(date); },
    percent: function (n, digits) {
      const v = Number(n) || 0;
      return v.toFixed(digits == null ? 1 : digits).replace(/\.0$/, '') + '%';
    },
    initials: function (first, last) {
      const a = String(first || '').trim().charAt(0);
      const b = String(last || '').trim().charAt(0);
      return (a + b || '?').toUpperCase();
    },
    fullName: function (client) {
      if (!client) return 'Deleted client';
      return [client.firstName, client.lastName].filter(Boolean).join(' ') || 'Unnamed client';
    },
    itemCount: function (n) { return n + (n === 1 ? ' item' : ' items'); },
    plural: function (n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  };

  /* ------------------------------- seeding ------------------------------ */

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  const SEED_CLIENTS = [
    ['Amina', 'Belkacem', 'Casablanca', 'Female', '+212 6 12 34 56 78'],
    ['Lucas', 'Moreau', 'Lyon', 'Male', '+33 6 84 21 09 44'],
    ['Sofia', 'Haddad', 'Rabat', 'Female', '+212 6 55 20 18 73'],
    ['Noah', 'Bernard', 'Paris', 'Male', '+33 7 12 65 30 18'],
    ['Yasmine', 'El Amrani', 'Marrakech', 'Female', '+212 6 70 44 92 10'],
    ['Ethan', 'Laurent', 'Bordeaux', 'Male', '+33 6 33 78 44 09'],
    ['Camille', 'Dubois', 'Nantes', 'Female', '+33 7 48 90 12 77'],
    ['Omar', 'Benali', 'Tangier', 'Male', '+212 6 61 73 25 40'],
    ['Léa', 'Fontaine', 'Lille', 'Female', '+33 6 29 04 56 91'],
    ['Mehdi', 'Cherkaoui', 'Fès', 'Male', '+212 6 90 11 38 57'],
    ['Clara', 'Petit', 'Toulouse', 'Female', '+33 6 77 52 19 03'],
    ['Adam', 'Rousseau', 'Strasbourg', 'Male', '+33 7 05 63 92 28'],
    ['Inès', 'Zeroual', 'Agadir', 'Female', '+212 6 46 80 22 15'],
    ['Gabriel', 'Mercier', 'Montpellier', 'Male', '+33 6 18 39 74 50'],
    ['Nadia', 'Saidi', 'Meknès', 'Female', '+212 6 22 57 09 64']
  ];

  const SEED_PRODUCTS = [
    ['AUR-HP-01', 'Aurora Wireless Headphones', 'Audio', 149, 42, 10],
    ['PLS-SPK-02', 'Pulse Bluetooth Speaker', 'Audio', 89, 8, 12],
    ['STM-MIC-03', 'Studio Mic Kit', 'Audio', 219, 15, 6],
    ['NIM-STD-04', 'Nimbus Laptop Stand', 'Workspace', 59, 63, 15],
    ['MER-MAT-05', 'Meridian Desk Mat', 'Workspace', 39, 4, 10],
    ['FLD-KBD-06', 'Fold Ergonomic Keyboard', 'Workspace', 129, 27, 8],
    ['ARC-ARM-07', 'Arc Monitor Arm', 'Workspace', 109, 0, 6],
    ['HAL-LMP-08', 'Halo Desk Lamp', 'Lighting', 79, 34, 10],
    ['LUM-BAR-09', 'Lumen Light Bar', 'Lighting', 69, 11, 12],
    ['BEA-LMP-10', 'Beam Floor Lamp', 'Lighting', 189, 7, 5],
    ['VLT-SSD-11', 'Vault SSD 1TB', 'Storage', 139, 22, 8],
    ['VLT-SSD-12', 'Vault SSD 2TB', 'Storage', 229, 9, 6],
    ['DCK-PRO-13', 'Dock Pro 8-in-1', 'Accessories', 99, 18, 8],
    ['CBL-SET-14', 'Cable Loop Set', 'Accessories', 24, 120, 25],
    ['SLT-MSE-15', 'Slate Wireless Mouse', 'Accessories', 49, 51, 12],
    ['VST-27D-16', 'Vista 27" 4K Display', 'Displays', 429, 12, 5],
    ['VST-34W-17', 'Vista 34" Ultrawide', 'Displays', 649, 3, 4],
    ['NMD-SLV-18', 'Nomad Laptop Sleeve 14"', 'Accessories', 45, 38, 10]
  ];

  const ORDER_NOTES = ['', '', '', 'Leave at reception.', 'Gift wrap requested.', 'Call before delivery.', 'Priority delivery.'];

  function buildSeed() {
    const rnd = mulberry32(0x51f15e);
    const now = new Date();
    now.setHours(12, 0, 0, 0);

    const clients = SEED_CLIENTS.map(function (row, i) {
      return {
        id: 'cl_' + (101 + i),
        firstName: row[0],
        lastName: row[1],
        city: row[2],
        gender: row[3],
        email: (row[0] + '.' + row[1]).toLowerCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z.]/g, '') + '@example.com',
        phone: row[4],
        createdAt: new Date(now.getTime() - Math.round((40 + rnd() * 520) * DAY)).toISOString()
      };
    });

    const products = SEED_PRODUCTS.map(function (row, i) {
      return {
        id: 'pr_' + (201 + i),
        sku: row[0], name: row[1], category: row[2],
        price: row[3], stock: row[4], reorder: row[5],
        createdAt: new Date(now.getTime() - Math.round((90 + rnd() * 430) * DAY)).toISOString()
      };
    });

    const offsets = [0, 1, 2, 3, 5, 8, 11, 15];
    for (let i = 0; i < 38; i++) offsets.push(Math.floor(rnd() * 175));

    const orders = offsets.map(function (offset, index) {
      const date = new Date(now.getTime() - offset * DAY);
      const age = offset;
      let status;
      if (age <= 2) status = rnd() < 0.72 ? 'pending' : 'paid';
      else if (age <= 7) status = rnd() < 0.5 ? 'paid' : (rnd() < 0.55 ? 'shipped' : 'pending');
      else if (age <= 30) status = rnd() < 0.44 ? 'paid' : (rnd() < 0.76 ? 'shipped' : 'cancelled');
      else status = rnd() < 0.67 ? 'shipped' : (rnd() < 0.8 ? 'paid' : 'cancelled');

      const lineCount = 1 + Math.floor(rnd() * 3);
      const used = {};
      const items = [];
      for (let j = 0; j < lineCount; j++) {
        let pi = Math.floor(rnd() * products.length);
        let guard = 0;
        while (used[pi] && guard++ < 20) pi = Math.floor(rnd() * products.length);
        used[pi] = true;
        const product = products[pi];
        items.push({
          productId: product.id,
          qty: 1 + Math.floor(rnd() * 3),
          unitPrice: product.price
        });
      }

      const client = index < clients.length ? clients[index] : clients[Math.floor(rnd() * clients.length)];
      return {
        id: 'ord_' + (1001 + index),
        number: 'ORD-' + (1001 + index),
        clientId: client.id,
        date: isoDate(date),
        status: status,
        items: items,
        note: ORDER_NOTES[Math.floor(rnd() * ORDER_NOTES.length)],
        createdAt: new Date(date.getTime() + (9 * 60 + Math.floor(rnd() * 540)) * 60000).toISOString()
      };
    });

    orders.sort(function (a, b) { return parseDate(a.date) - parseDate(b.date); });
    orders.forEach(function (order, i) {
      order.number = 'ORD-' + (1001 + i);
      order.id = 'ord_' + (1001 + i);
    });

    return {
      version: SCHEMA_VERSION,
      clients: clients,
      products: products,
      orders: orders,
      settings: Object.assign({}, DEFAULT_SETTINGS),
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        demo: true
      }
    };
  }

  /* --------------------------- state + helpers -------------------------- */

  let state = null;

  function normalizeState(raw) {
    return {
      version: SCHEMA_VERSION,
      clients: Array.isArray(raw.clients) ? raw.clients : [],
      products: Array.isArray(raw.products) ? raw.products : [],
      orders: Array.isArray(raw.orders) ? raw.orders : [],
      settings: Object.assign({}, DEFAULT_SETTINGS, raw.settings || {}),
      meta: Object.assign({
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        demo: false
      }, raw.meta || {})
    };
  }

  function load() {
    try {
      const raw = global.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.clients) && Array.isArray(parsed.products) && Array.isArray(parsed.orders)) {
          state = normalizeState(parsed);
          return state;
        }
      }
    } catch (err) { /* corrupt or unavailable storage */ }
    state = buildSeed();
    persist();
    return state;
  }

  function persist() {
    if (!state) return false;
    state.meta.updatedAt = new Date().toISOString();
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (err) {
      return false;
    }
  }

  function getState() {
    if (!state) load();
    return state;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function nextId(list, prefix, start) {
    let max = (start || 1) - 1;
    list.forEach(function (item) {
      const match = String(item.id || '').match(/(\d+)$/);
      if (match) max = Math.max(max, Number(match[1]));
    });
    return prefix + (max + 1);
  }

  function nextOrderIdentity() {
    let max = 1000;
    getState().orders.forEach(function (order) {
      const match = String(order.number || order.id || '').match(/(\d+)$/);
      if (match) max = Math.max(max, Number(match[1]));
    });
    return { id: 'ord_' + (max + 1), number: 'ORD-' + (max + 1) };
  }

  function clean(value) { return String(value == null ? '' : value).trim(); }

  function numeric(value) {
    if (typeof value === 'number') return value;
    const normalized = String(value == null ? '' : value).replace(',', '.').replace(/[^0-9.-]/g, '');
    return Number(normalized);
  }

  function uniqueSku(sku, ignoreId) {
    return !getState().products.some(function (p) {
      return p.id !== ignoreId && String(p.sku).toLowerCase() === sku.toLowerCase();
    });
  }

  /* ---------------------------- validation ----------------------------- */

  function validateClient(input) {
    const errors = {};
    const value = {
      firstName: clean(input.firstName),
      lastName: clean(input.lastName),
      email: clean(input.email),
      phone: clean(input.phone),
      city: clean(input.city),
      gender: clean(input.gender)
    };
    if (!value.firstName) errors.firstName = 'First name is required.';
    if (!value.lastName) errors.lastName = 'Last name is required.';
    if (!value.city) errors.city = 'City is required.';
    if (value.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.email)) {
      errors.email = 'Enter a valid email address.';
    }
    if (value.phone && !/^[+()\d\s.\-]{6,}$/.test(value.phone)) {
      errors.phone = 'Enter a valid phone number.';
    }
    if (value.gender && GENDERS.indexOf(value.gender) === -1) {
      errors.gender = 'Choose a valid option.';
    }
    return { ok: Object.keys(errors).length === 0, errors: errors, value: value };
  }

  function validateProduct(input, ignoreId) {
    const errors = {};
    const priceRaw = clean(input.price);
    const stockRaw = clean(input.stock);
    const reorderRaw = clean(input.reorder);
    const value = {
      name: clean(input.name),
      sku: clean(input.sku).toUpperCase(),
      category: clean(input.category),
      price: numeric(priceRaw),
      stock: numeric(stockRaw),
      reorder: numeric(reorderRaw)
    };
    if (!value.name) errors.name = 'Product name is required.';
    if (!value.sku) errors.sku = 'SKU is required.';
    else if (!uniqueSku(value.sku, ignoreId)) errors.sku = 'This SKU is already used by another product.';
    if (!value.category) errors.category = 'Choose a category.';
    if (priceRaw === '' || !Number.isFinite(value.price) || value.price < 0) errors.price = 'Enter a price of 0 or more.';
    if (stockRaw === '' || !Number.isInteger(value.stock) || value.stock < 0) errors.stock = 'Stock must be a whole number, 0 or more.';
    if (reorderRaw === '' || !Number.isInteger(value.reorder) || value.reorder < 0) errors.reorder = 'Threshold must be a whole number, 0 or more.';
    return { ok: Object.keys(errors).length === 0, errors: errors, value: value };
  }

  function validateOrder(input, ignoreId) {
    const errors = {};
    const data = getState();
    const value = {
      clientId: clean(input.clientId),
      date: clean(input.date).slice(0, 10),
      status: clean(input.status) || 'pending',
      note: clean(input.note),
      items: []
    };

    if (!value.clientId || !data.clients.some(function (c) { return c.id === value.clientId; })) {
      errors.clientId = 'Choose a client for this order.';
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value.date) || Number.isNaN(parseDate(value.date).getTime())) {
      errors.date = 'Choose a valid order date.';
    } else if (value.date > todayISO()) {
      errors.date = 'The order date cannot be in the future.';
    }
    if (STATUS_IDS.indexOf(value.status) === -1) errors.status = 'Choose a valid status.';

    const seen = {};
    (Array.isArray(input.items) ? input.items : []).forEach(function (line) {
      const product = data.products.find(function (p) { return p.id === line.productId; });
      const qty = numeric(line.qty);
      const unitPrice = line.unitPrice == null || line.unitPrice === '' ? (product ? product.price : NaN) : numeric(line.unitPrice);
      if (!product || seen[product.id]) return;
      if (!Number.isInteger(qty) || qty < 1 || qty > 999) return;
      if (!Number.isFinite(unitPrice) || unitPrice < 0) return;
      seen[product.id] = true;
      value.items.push({ productId: product.id, qty: qty, unitPrice: Math.round(unitPrice * 100) / 100 });
    });

    if (value.items.length === 0) errors.items = 'Add at least one product with a quantity.';
    if (value.items.length !== (Array.isArray(input.items) ? input.items.length : 0) && !errors.items) {
      errors.items = 'One of the items is invalid or duplicated.';
    }
    return { ok: Object.keys(errors).length === 0, errors: errors, value: value };
  }

  /* ------------------------------- CRUD -------------------------------- */

  function getClients() { return getState().clients.slice(); }
  function getProducts() { return getState().products.slice(); }
  function getOrders() { return getState().orders.slice(); }

  function getClient(id) {
    return getState().clients.find(function (c) { return c.id === id; }) || null;
  }
  function getProduct(id) {
    return getState().products.find(function (p) { return p.id === id; }) || null;
  }
  function getOrder(id) {
    return getState().orders.find(function (o) { return o.id === id; }) || null;
  }

  function createClient(input) {
    const result = validateClient(input);
    if (!result.ok) return result;
    const client = Object.assign({ id: nextId(getState().clients, 'cl_', 101), createdAt: new Date().toISOString() }, result.value);
    getState().clients.unshift(client);
    persist();
    return { ok: true, item: client };
  }

  function updateClient(id, input) {
    const client = getClient(id);
    if (!client) return { ok: false, errors: {}, error: 'Client not found.' };
    const result = validateClient(input);
    if (!result.ok) return result;
    Object.assign(client, result.value);
    persist();
    return { ok: true, item: client };
  }

  function deleteClient(id) {
    const client = getClient(id);
    if (!client) return { ok: false, error: 'Client not found.' };
    const count = getState().orders.filter(function (o) { return o.clientId === id; }).length;
    if (count > 0) {
      return { ok: false, error: fmt.fullName(client) + ' has ' + fmt.plural(count, 'order') + '. Delete those orders first.' };
    }
    getState().clients = getState().clients.filter(function (c) { return c.id !== id; });
    persist();
    return { ok: true };
  }

  function createProduct(input) {
    const result = validateProduct(input);
    if (!result.ok) return result;
    const product = Object.assign({ id: nextId(getState().products, 'pr_', 201), createdAt: new Date().toISOString() }, result.value);
    getState().products.unshift(product);
    persist();
    return { ok: true, item: product };
  }

  function updateProduct(id, input) {
    const product = getProduct(id);
    if (!product) return { ok: false, errors: {}, error: 'Product not found.' };
    const result = validateProduct(input, id);
    if (!result.ok) return result;
    Object.assign(product, result.value);
    persist();
    return { ok: true, item: product };
  }

  function deleteProduct(id) {
    const product = getProduct(id);
    if (!product) return { ok: false, error: 'Product not found.' };
    const count = getState().orders.filter(function (o) {
      return o.items.some(function (line) { return line.productId === id; });
    }).length;
    if (count > 0) {
      return { ok: false, error: product.name + ' appears in ' + fmt.plural(count, 'order') + '. Remove it from those orders first.' };
    }
    getState().products = getState().products.filter(function (p) { return p.id !== id; });
    persist();
    return { ok: true };
  }

  function createOrder(input) {
    const result = validateOrder(input);
    if (!result.ok) return result;
    const identity = nextOrderIdentity();
    const order = Object.assign({ id: identity.id, number: identity.number, createdAt: new Date().toISOString() }, result.value);
    getState().orders.push(order);
    persist();
    return { ok: true, item: order };
  }

  function updateOrder(id, input) {
    const order = getOrder(id);
    if (!order) return { ok: false, errors: {}, error: 'Order not found.' };
    const result = validateOrder(input, id);
    if (!result.ok) return result;
    Object.assign(order, result.value);
    persist();
    return { ok: true, item: order };
  }

  function deleteOrder(id) {
    if (!getOrder(id)) return { ok: false, error: 'Order not found.' };
    getState().orders = getState().orders.filter(function (o) { return o.id !== id; });
    persist();
    return { ok: true };
  }

  function orderTotal(order) {
    return (order.items || []).reduce(function (sum, line) {
      return sum + (Number(line.unitPrice) || 0) * (Number(line.qty) || 0);
    }, 0);
  }

  function orderUnits(order) {
    return (order.items || []).reduce(function (sum, line) { return sum + (Number(line.qty) || 0); }, 0);
  }

  /* ------------------------------- stats ------------------------------- */

  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

  function delta(current, previous) {
    if (!previous) return current ? 100 : 0;
    return ((current - previous) / previous) * 100;
  }

  function clientSummary(clientId) {
    const orders = getState().orders.filter(function (o) { return o.clientId === clientId; });
    const active = orders.filter(function (o) { return o.status !== 'cancelled'; });
    return {
      orders: active.length,
      value: active.reduce(function (sum, o) { return sum + orderTotal(o); }, 0),
      lastOrder: active.reduce(function (latest, o) { return !latest || o.date > latest ? o.date : latest; }, '')
    };
  }

  function productSales(productId) {
    let units = 0;
    let revenue = 0;
    getState().orders.forEach(function (order) {
      if (order.status === 'cancelled') return;
      order.items.forEach(function (line) {
        if (line.productId === productId) {
          units += Number(line.qty) || 0;
          revenue += (Number(line.unitPrice) || 0) * (Number(line.qty) || 0);
        }
      });
    });
    return { units: units, revenue: revenue };
  }

  function stats() {
    const data = getState();
    const now = new Date();
    const today = startOfDay(now);
    const cut30 = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29);
    const cut60 = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 59);

    const active = data.orders.filter(function (o) { return o.status !== 'cancelled'; });
    const inWindow = function (o, from, to) {
      const d = parseDate(o.date);
      return d >= from && (!to || d < to);
    };

    const last30 = active.filter(function (o) { return inWindow(o, cut30); });
    const prev30 = active.filter(function (o) { return inWindow(o, cut60, cut30); });
    const revenue30 = last30.reduce(function (s, o) { return s + orderTotal(o); }, 0);
    const revenuePrev = prev30.reduce(function (s, o) { return s + orderTotal(o); }, 0);

    const newClients30 = data.clients.filter(function (c) { return new Date(c.createdAt) >= cut30; }).length;
    const newClientsPrev = data.clients.filter(function (c) {
      const d = new Date(c.createdAt);
      return d >= cut60 && d < cut30;
    }).length;

    const lowStock = data.products
      .filter(function (p) { return p.stock <= p.reorder; })
      .sort(function (a, b) { return a.stock - b.stock || a.name.localeCompare(b.name); });

    const statusCounts = {};
    STATUS_IDS.forEach(function (id) {
      statusCounts[id] = { count: 0, value: 0 };
    });
    data.orders.forEach(function (o) {
      if (!statusCounts[o.status]) statusCounts[o.status] = { count: 0, value: 0 };
      statusCounts[o.status].count += 1;
      statusCounts[o.status].value += orderTotal(o);
    });

    const series = [];
    for (let i = 5; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const total = active.reduce(function (sum, o) {
        const d = parseDate(o.date);
        return d >= start && d < end ? sum + orderTotal(o) : sum;
      }, 0);
      series.push({
        key: start.getFullYear() + '-' + pad(start.getMonth() + 1),
        label: fmt.month(start),
        total: total
      });
    }

    const salesByProduct = {};
    active.forEach(function (o) {
      o.items.forEach(function (line) {
        if (!salesByProduct[line.productId]) salesByProduct[line.productId] = { units: 0, revenue: 0 };
        salesByProduct[line.productId].units += Number(line.qty) || 0;
        salesByProduct[line.productId].revenue += (Number(line.unitPrice) || 0) * (Number(line.qty) || 0);
      });
    });
    const topProducts = Object.keys(salesByProduct)
      .map(function (id) { return Object.assign({ product: getProduct(id) }, salesByProduct[id]); })
      .filter(function (row) { return row.product; })
      .sort(function (a, b) { return b.units - a.units; })
      .slice(0, 5);

    const recentOrders = data.orders.slice().sort(function (a, b) {
      return parseDate(b.date) - parseDate(a.date) || String(b.number).localeCompare(String(a.number));
    }).slice(0, 6);

    const activeCount = active.length;

    return {
      revenue30: revenue30,
      revenueDelta: delta(revenue30, revenuePrev),
      orders30: last30.length,
      ordersDelta: delta(last30.length, prev30.length),
      avgOrder: last30.length ? revenue30 / last30.length : 0,
      totalClients: data.clients.length,
      newClients30: newClients30,
      clientsDelta: delta(newClients30, newClientsPrev),
      totalProducts: data.products.length,
      lowStock: lowStock,
      lowStockCount: lowStock.length,
      outOfStock: lowStock.filter(function (p) { return p.stock === 0; }).length,
      subscribers: data.clients.length,
      totalOrders: data.orders.length,
      activeOrders: activeCount,
      series: series,
      statusCounts: statusCounts,
      topProducts: topProducts,
      recentOrders: recentOrders
    };
  }

  /* --------------------------- import / export -------------------------- */

  function normalizeImport(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('The file is not a valid JSON workspace.');

    let src = raw;
    if (raw.data && typeof raw.data === 'object' && Array.isArray(raw.data.clients)) src = raw.data;
    if (!Array.isArray(src.clients) || !Array.isArray(src.products) || !Array.isArray(src.orders)) {
      throw new Error('Expected "clients", "products", and "orders" arrays.');
    }
    if (!src.clients.length && !src.products.length && !src.orders.length) {
      throw new Error('The backup is empty.');
    }

    const clientIds = {};
    const clients = src.clients.map(function (item, i) {
      if (!item || typeof item !== 'object') throw new Error('Invalid client at position ' + (i + 1) + '.');
      const id = clean(item.id) || 'cl_import_' + (i + 1);
      if (clientIds[id]) throw new Error('Duplicate client id "' + id + '".');
      clientIds[id] = true;
      const firstName = clean(item.firstName || item.prenom);
      const lastName = clean(item.lastName || item.nom);
      return {
        id: id,
        firstName: firstName || 'Unnamed',
        lastName: lastName,
        email: clean(item.email),
        phone: clean(item.phone),
        city: clean(item.city || item.ville),
        gender: GENDERS.indexOf(item.gender) !== -1 ? item.gender : '',
        createdAt: isNaN(new Date(item.createdAt).getTime()) ? new Date().toISOString() : new Date(item.createdAt).toISOString()
      };
    });

    const productIds = {};
    const products = src.products.map(function (item, i) {
      if (!item || typeof item !== 'object') throw new Error('Invalid product at position ' + (i + 1) + '.');
      const id = clean(item.id) || 'pr_import_' + (i + 1);
      if (productIds[id]) throw new Error('Duplicate product id "' + id + '".');
      const name = clean(item.name || item.libelle) || 'Untitled product';
      const sku = clean(item.sku || item.CodePrd) || 'SKU-' + (i + 1);
      const price = numeric(item.price != null ? item.price : item.prix);
      const stock = numeric(item.stock);
      const reorder = numeric(item.reorder);
      productIds[id] = true;
      return {
        id: id,
        sku: sku.toUpperCase(),
        name: name,
        category: CATEGORIES.indexOf(item.category) !== -1 ? item.category : 'Accessories',
        price: Number.isFinite(price) && price >= 0 ? price : 0,
        stock: Number.isInteger(stock) && stock >= 0 ? stock : 0,
        reorder: Number.isInteger(reorder) && reorder >= 0 ? reorder : 0,
        createdAt: isNaN(new Date(item.createdAt).getTime()) ? new Date().toISOString() : new Date(item.createdAt).toISOString()
      };
    });

    const orderIds = {};
    const numbers = {};
    const orders = src.orders.map(function (item, i) {
      if (!item || typeof item !== 'object') throw new Error('Invalid order at position ' + (i + 1) + '.');
      if (!clientIds[item.clientId]) {
        throw new Error('Order ' + (item.number || i + 1) + ' references a missing client.');
      }
      const seen = {};
      const items = (Array.isArray(item.items) ? item.items : []).reduce(function (lines, line) {
        if (!line || !productIds[line.productId] || seen[line.productId]) return lines;
        const product = products.find(function (p) { return p.id === line.productId; });
        const qty = numeric(line.qty);
        const price = numeric(line.unitPrice);
        seen[line.productId] = true;
        lines.push({
          productId: line.productId,
          qty: Number.isInteger(qty) && qty > 0 ? Math.min(qty, 999) : 1,
          unitPrice: Number.isFinite(price) && price >= 0 ? price : product.price
        });
        return lines;
      }, []);
      if (!items.length) throw new Error('Order ' + (item.number || i + 1) + ' has no valid line items.');

      let id = clean(item.id) || 'ord_import_' + (i + 1);
      if (orderIds[id]) throw new Error('Duplicate order id "' + id + '".');
      orderIds[id] = true;

      let number = clean(item.number) || 'ORD-' + (1001 + i);
      if (numbers[number]) number = number + '-' + (i + 1);
      numbers[number] = true;

      let date = clean(item.date).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(parseDate(date).getTime())) date = todayISO();

      return {
        id: id,
        number: number,
        clientId: item.clientId,
        date: date,
        status: STATUS_IDS.indexOf(item.status) !== -1 ? item.status : 'pending',
        items: items,
        note: clean(item.note),
        createdAt: isNaN(new Date(item.createdAt).getTime()) ? new Date().toISOString() : new Date(item.createdAt).toISOString()
      };
    });

    const theme = src.settings && ['light', 'dark', 'system'].indexOf(src.settings.theme) !== -1 ? src.settings.theme : 'system';
    return normalizeState({
      clients: clients,
      products: products,
      orders: orders,
      settings: { theme: theme },
      meta: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), demo: false }
    });
  }

  function importData(payload) {
    try {
      const raw = typeof payload === 'string' ? JSON.parse(payload) : payload;
      const imported = normalizeImport(raw);
      state = imported;
      persist();
      return {
        ok: true,
        counts: {
          clients: state.clients.length,
          products: state.products.length,
          orders: state.orders.length
        }
      };
    } catch (err) {
      return { ok: false, error: err.message || 'Could not import this file.' };
    }
  }

  function exportData() {
    return {
      app: 'GestCom',
      schema: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      data: clone(getState())
    };
  }

  function storageInfo() {
    const json = JSON.stringify(getState());
    let bytes = json.length * 2;
    try { bytes = new Blob([json]).size; } catch (err) { /* keep estimate */ }
    return {
      bytes: bytes,
      limit: 5 * 1024 * 1024,
      percent: Math.min(100, (bytes / (5 * 1024 * 1024)) * 100),
      updatedAt: getState().meta.updatedAt,
      demo: !!getState().meta.demo
    };
  }

  function getSettings() { return getState().settings; }

  function updateSettings(patch) {
    Object.assign(getState().settings, patch || {});
    persist();
    return getState().settings;
  }

  function resetDemo() { state = buildSeed(); persist(); return state; }

  function clearAll() {
    getState().clients = [];
    getState().products = [];
    getState().orders = [];
    getState().meta.demo = false;
    persist();
    return state;
  }

  function removeAllOrders() {
    getState().orders = [];
    persist();
  }

  global.GestCom = global.GestCom || {};
  global.GestCom.store = {
    STATUSES: STATUSES,
    CATEGORIES: CATEGORIES,
    GENDERS: GENDERS,
    load: load,
    getState: getState,
    getClients: getClients,
    getProducts: getProducts,
    getOrders: getOrders,
    getClient: getClient,
    getProduct: getProduct,
    getOrder: getOrder,
    createClient: createClient,
    updateClient: updateClient,
    deleteClient: deleteClient,
    createProduct: createProduct,
    updateProduct: updateProduct,
    deleteProduct: deleteProduct,
    createOrder: createOrder,
    updateOrder: updateOrder,
    deleteOrder: deleteOrder,
    orderTotal: orderTotal,
    orderUnits: orderUnits,
    clientSummary: clientSummary,
    productSales: productSales,
    stats: stats,
    importData: importData,
    exportData: exportData,
    storageInfo: storageInfo,
    getSettings: getSettings,
    updateSettings: updateSettings,
    resetDemo: resetDemo,
    clearAll: clearAll,
    removeAllOrders: removeAllOrders
  };
  global.GestCom.fmt = fmt;
  global.GestCom.todayISO = todayISO;
})(window);
