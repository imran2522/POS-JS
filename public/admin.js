// Manager screens: products + stock, shop and receipt details.
export function createAdmin({ api, showModal, esc, friendly, fmt, closeBtn, errorLine, onProductsChange, onShopChange }) {
  let products = [];
  const dollars = (c) => (c / 100).toFixed(2);
  const pct = (r) => String(Math.round(r * 10000) / 100);
  const back = '<button data-menu="menu" class="ghost">Back</button>';

  async function showProducts(message = '') {
    try {
      products = await api.loadAllProducts();
      showModal(`
        <h3>Products and stock</h3>
        ${products.length ? products.map((p) => `
          <p class="${p.active ? '' : 'inactive'}">
            <span>${esc(p.name)}<small>${esc(p.sku)} · ${fmt(p.price)} · tax ${pct(p.taxRate)}% · stock ${p.stock}${p.active ? '' : ' · hidden from till'}</small></span>
            <button class="small ghost" data-edit="${esc(p.sku)}">Edit</button>
          </p>`).join('') : '<p class="empty">No products yet.</p>'}
        <button data-newprod>Add product</button>
        ${errorLine(message)}${back}${closeBtn}`);
    } catch (err) {
      showModal(`<h3>Products and stock</h3>${errorLine(friendly(err))}${back}${closeBtn}`);
    }
  }

  function showProductForm(sku, message = '', values) {
    const p = sku ? products.find((x) => x.sku === sku) : null;
    const v = values ?? (p
      ? { sku: p.sku, name: p.name, price: dollars(p.price), tax: pct(p.taxRate), stock: String(p.stock), active: p.active }
      : { sku: '', name: '', price: '', tax: '0', stock: '0', active: true });
    showModal(`
      <h3>${p ? 'Edit product' : 'New product'}</h3>
      <form id="productForm" class="stack">
        <input type="hidden" name="mode" value="${p ? 'edit' : 'new'}" />
        <label>SKU or barcode <input name="sku" value="${esc(v.sku)}" ${p ? 'readonly' : ''} required pattern="[A-Za-z0-9._-]{1,30}" /></label>
        <label>Name <input name="name" value="${esc(v.name)}" maxlength="60" required /></label>
        <label>Price <input name="price" value="${esc(v.price)}" inputmode="decimal" placeholder="4.50" required /></label>
        <label>Tax % <input name="tax" value="${esc(v.tax)}" inputmode="decimal" placeholder="8" required /></label>
        <label>In stock <input name="stock" type="number" min="0" step="1" value="${esc(v.stock)}" required /></label>
        ${p ? `<label class="check"><input type="checkbox" name="active" ${v.active ? 'checked' : ''} /> Show on the till</label>` : ''}
        <button type="submit">${p ? 'Save changes' : 'Add product'}</button>
        <button type="button" class="ghost" data-cancelprod>Cancel</button>
      </form>
      ${errorLine(message)}`);
  }

  async function showShop(message = '', values, ok = false) {
    const s = values ?? await api.loadShop();
    showModal(`
      <h3>Shop and receipt details</h3>
      <form id="shopForm" class="stack">
        <label>Shop name <input name="shopName" value="${esc(s.shopName)}" maxlength="40" required /></label>
        <label>Address <textarea name="address" rows="2" maxlength="120">${esc(s.address)}</textarea></label>
        <label>Phone <input name="phone" value="${esc(s.phone)}" maxlength="30" /></label>
        <label>Receipt footer <input name="footer" value="${esc(s.footer)}" maxlength="80" /></label>
        <label>Currency code <input name="currency" value="${esc(s.currency)}" maxlength="3" placeholder="USD" required /></label>
        <button type="submit">Save</button>
      </form>
      ${message ? `<p class="${ok ? '' : 'error'}" role="status">${esc(message)}</p>` : ''}${back}${closeBtn}`);
  }

  async function handleClick(e) {
    const d = e.target.dataset;
    if (d.edit) { showProductForm(d.edit); return true; }
    if ('newprod' in d) { showProductForm(); return true; }
    if ('cancelprod' in d) { showProducts(); return true; }
    return false;
  }

  async function handleSubmit(e) {
    const id = e.target.id;
    if (id !== 'productForm' && id !== 'shopForm') return false;
    const f = Object.fromEntries(new FormData(e.target));

    if (id === 'shopForm') {
      try {
        const saved = await api.saveShop({ ...f, currency: String(f.currency).toUpperCase() });
        onShopChange(saved);
        showShop('Saved.', saved, true);
      } catch (err) { showShop(friendly(err), f); }
      return true;
    }

    const editing = f.mode === 'edit';
    const values = { sku: f.sku, name: f.name, price: f.price, tax: f.tax, stock: f.stock, active: editing ? f.active === 'on' : true };
    const fail = (m) => showProductForm(editing ? f.sku : undefined, m, values);
    const price = String(f.price).trim(), tax = String(f.tax).trim();
    if (!/^\d{1,7}(\.\d{1,2})?$/.test(price)) return fail('Price should look like 4.50'), true;
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(tax) || Number(tax) > 100) return fail('Tax % should be between 0 and 100'), true;
    const body = {
      name: String(f.name).trim(), price: Math.round(Number(price) * 100),
      taxRate: Math.round(Number(tax) * 100) / 10000, stock: Number(f.stock),
    };
    try {
      if (editing) await api.updateProduct(f.sku, { ...body, active: values.active });
      else await api.createProduct({ sku: String(f.sku).trim(), ...body });
      await onProductsChange();
      showProducts(editing ? '' : '');
    } catch (err) { fail(friendly(err)); }
    return true;
  }

  return { showProducts, showShop, handleClick, handleSubmit };
}
