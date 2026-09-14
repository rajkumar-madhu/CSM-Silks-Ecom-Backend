import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Boxes,
  CheckCircle2,
  ImagePlus,
  Layers3,
  PackagePlus,
  Pencil,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { inr } from '@/lib/money';
import { useCatalogLiveRefresh } from '@/lib/useCatalogLiveRefresh';
import { ProductVisual } from '@/ui/components';
import { editFormFromProduct, primaryVariantId, type AdminEditForm } from '@/lib/adminCatalog';
import { AdminChoice } from './AdminChoice';
import type { AdminProductQuickCreatePayload, CatalogCategory, CatalogCollection, Product } from '@/types';

type CatalogTab = 'products' | 'add' | 'collections';

type ProductForm = {
  name: string;
  slug: string;
  gender: Product['gender'];
  category_name: string;
  collection_name: string;
  hook: string;
  description: string;
  price: string;
  mrp: string;
  stock_qty: string;
  sku: string;
  color_name: string;
  color_hex: string;
  fabric: string;
  zari_type: string;
  image_url: string;
  deal_label: string;
  tags_text: string;
  occasions_text: string;
  is_featured: boolean;
  blouse_included: boolean;
};

const CATALOG_PAGE_SIZE = 25;

const initialProductForm: ProductForm = {
  name: '',
  slug: '',
  gender: 'women',
  category_name: 'Kanjivaram',
  collection_name: 'Fresh Arrivals',
  hook: '',
  description: '',
  price: '',
  mrp: '',
  stock_qty: '10',
  sku: '',
  color_name: 'Ruby',
  color_hex: '#842033',
  fabric: 'Pure silk',
  zari_type: 'Gold zari',
  image_url: '',
  deal_label: 'New arrival',
  tags_text: 'kanjivaram, pure silk',
  occasions_text: 'Wedding, Festival',
  is_featured: true,
  blouse_included: true,
};

function toSlug(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export function AdminCatalogManager() {
  const [tab, setTab] = useState<CatalogTab>('products');
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [collections, setCollections] = useState<CatalogCollection[]>([]);
  const [form, setForm] = useState<ProductForm>(initialProductForm);
  const [collectionForm, setCollectionForm] = useState({ name: '', description: '', is_featured: true });
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [totalProducts, setTotalProducts] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editForm, setEditForm] = useState<AdminEditForm | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const loadCatalog = useCallback(async (pageNum = 1, append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      const [productData, categoryData, collectionData] = await Promise.all([
        api.admin.products({ page: pageNum, per_page: CATALOG_PAGE_SIZE }),
        api.admin.categories(),
        api.admin.collections(),
      ]);
      setProducts(prev => {
        if (!append) return productData.items;
        const known = new Set(prev.map(item => item.id));
        return [...prev, ...productData.items.filter(item => !known.has(item.id))];
      });
      setPage(productData.page);
      setTotalProducts(productData.total);
      setTotalPages(productData.pages || 0);
      setCategories(categoryData);
      setCollections(collectionData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load catalog');
      if (!append) setProducts([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => void loadCatalog(1, false), 0);
    return () => window.clearTimeout(id);
  }, [loadCatalog]);

  const realtimeStatus = useCatalogLiveRefresh({
    onUpdate: message => {
      setNotice(
        message.product?.name
          ? `Live catalog update received for ${message.product.name}.`
          : 'Live catalog update received.',
      );
      void loadCatalog(1, false);
    },
  });

  const filteredProducts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return products;
    return products.filter(product =>
      [product.name, product.cat, product.slug, product.variants?.[0]?.sku]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(needle)),
    );
  }, [products, query]);

  const previewProduct: Partial<Product> = {
    id: 0,
    slug: form.slug || toSlug(form.name) || 'new-product',
    name: form.name || 'New CSM silk product',
    cat: form.category_name || 'Collection',
    price: Number(form.price || 0),
    mrp: Number(form.mrp || form.price || 0),
    gender: form.gender,
    hook: form.hook || form.fabric,
    colors: [form.color_hex || '#842033', '#C4923A', '#0C604F'],
    images: form.image_url ? [form.image_url] : [],
  };

  const createProduct = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setNotice('');
    setError('');
    try {
      const payload: AdminProductQuickCreatePayload = {
        name: form.name.trim(),
        slug: form.slug.trim() || undefined,
        gender: form.gender,
        category_name: form.category_name.trim(),
        collection_name: form.collection_name.trim(),
        hook: form.hook.trim(),
        description: form.description.trim(),
        price: Number(form.price),
        mrp: Number(form.mrp || form.price),
        stock_qty: Number(form.stock_qty || 0),
        sku: form.sku.trim() || undefined,
        color_name: form.color_name.trim(),
        color_hex: form.color_hex.trim(),
        fabric: form.fabric.trim(),
        zari_type: form.zari_type.trim(),
        image_url: form.image_url.trim(),
        deal_label: form.deal_label.trim(),
        tags_text: form.tags_text.trim(),
        occasions_text: form.occasions_text.trim(),
        is_featured: form.is_featured,
        blouse_included: form.blouse_included,
        is_active: true,
        assured: true,
        cod_available: true,
        exchange_available: true,
        return_days: 15,
      };
      if (!payload.name || !payload.category_name || !payload.price || !payload.mrp) {
        throw new Error('Name, category, price, and MRP are required.');
      }
      const created = await api.admin.createProductQuick(payload);
      setForm(initialProductForm);
      setNotice(`${created.name} is live in the customer catalog with ${created.available_qty || 0} stock.`);
      setTab('products');
      void loadCatalog(1, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create product');
    } finally {
      setSaving(false);
    }
  };

  const createCollection = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setNotice('');
    setError('');
    try {
      const name = collectionForm.name.trim();
      if (!name) throw new Error('Collection name is required.');
      const collection = await api.admin.createCollection({
        name,
        slug: toSlug(name),
        description: collectionForm.description.trim(),
        is_featured: collectionForm.is_featured,
      });
      setCollections(prev => [collection, ...prev]);
      setCollectionForm({ name: '', description: '', is_featured: true });
      setNotice(`${collection.name} collection is ready for product assignment.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create collection');
    } finally {
      setSaving(false);
    }
  };

  const uploadImage = async (file?: File) => {
    if (!file) return;
    setUploadingImage(true);
    setError('');
    try {
      const result = await api.admin.uploadProductImage(file);
      setForm(prev => ({ ...prev, image_url: result.image_url }));
      setNotice('Product photo uploaded and attached to the preview.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to upload image');
    } finally {
      setUploadingImage(false);
    }
  };

  const startEdit = async (product: Product) => {
    setError('');
    setNotice('');
    setEditingProduct(product);
    setEditForm(editFormFromProduct(product));
    setEditLoading(true);
    try {
      const fullProduct = await api.admin.getProduct(product.id);
      setEditingProduct(fullProduct);
      setEditForm(editFormFromProduct(fullProduct));
      window.setTimeout(() => {
        document.querySelector('.admin-edit-modal')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load product for editing');
    } finally {
      setEditLoading(false);
    }
  };

  const cancelEdit = () => {
    setEditingProduct(null);
    setEditForm(null);
  };

  const saveEdit = async () => {
    if (!editingProduct || !editForm) return;
    const price = Number(editForm.price);
    const mrp = Number(editForm.mrp);
    const stockQty = Number(editForm.stock_qty);
    if (!editForm.name.trim()) {
      setError('Product name is required.');
      return;
    }
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(mrp) || mrp <= 0) {
      setError('Enter valid selling price and MRP.');
      return;
    }
    if (!Number.isFinite(stockQty) || stockQty < 0) {
      setError('Enter a valid stock quantity.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const updated = await api.admin.updateProduct(editingProduct.id, {
        name: editForm.name.trim(),
        hook: editForm.hook.trim(),
        deal_label: editForm.deal_label.trim(),
        is_featured: editForm.is_featured,
        is_active: editForm.is_active,
        base_price: price,
        base_mrp: mrp,
      });
      const variantId = primaryVariantId(editingProduct);
      if (variantId) {
        await api.admin.updateVariant(variantId, {
          price,
          mrp,
          stock_qty: stockQty,
        });
      }
      setProducts(prev => prev.map(item => (item.id === updated.id ? { ...item, ...updated } : item)));
      setNotice(`${updated.name} updated successfully.`);
      cancelEdit();
      void loadCatalog(1, false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update product');
    } finally {
      setSaving(false);
    }
  };

  const deactivateProduct = async (product: Product) => {
    if (!window.confirm(`Deactivate "${product.name}"? It will disappear from the customer store.`)) return;
    setError('');
    try {
      await api.admin.deleteProduct(product.id);
      setProducts(prev => prev.filter(item => item.id !== product.id));
      if (editingProduct?.id === product.id) cancelEdit();
      setNotice(`${product.name} deactivated from the catalog.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to deactivate product');
    }
  };

  const totalStock = products.reduce((sum, product) => sum + Number(product.available_qty || 0), 0);
  const activeCount = products.filter(product => Number(product.available_qty || 0) > 0).length;
  const featuredCount = products.filter(product => product.is_featured).length;

  return (
    <div className="admin-catalog">
      <div className="admin-panel-head">
        <div>
          <span className="admin-eyebrow">Catalog operations</span>
          <h2>Products, collections, and live stock</h2>
          <p>Create, edit, and deactivate SKUs. Changes sync to the customer storefront in real time.</p>
        </div>
        <div className="admin-head-actions">
          <span className={`ws-chip ${realtimeStatus}`}>{realtimeStatus === 'connected' ? 'Live catalog' : realtimeStatus}</span>
          <button className="admin-soft-btn" onClick={() => void loadCatalog(1, false)} disabled={loading}>
            <RefreshCw size={16} /> Refresh
          </button>
          <button className="admin-primary-btn" onClick={() => setTab('add')}>
            <PackagePlus size={16} /> Add product
          </button>
        </div>
      </div>

      {(notice || error) && (
        <div className={`admin-alert ${error ? 'bad' : 'good'}`}>
          {error ? error : notice}
        </div>
      )}

      <div className="admin-tabs">
        {[
          ['products', Boxes, 'Products'],
          ['add', PackagePlus, 'Add product'],
          ['collections', Layers3, 'Collections'],
        ].map(([key, Icon, label]) => {
          const IconComp = Icon as typeof Boxes;
          return (
            <button type="button" key={key as string} className={tab === key ? 'active' : ''} onClick={() => setTab(key as CatalogTab)}>
              <IconComp size={16} /> {label as string}
            </button>
          );
        })}
      </div>

      {tab === 'products' && (
        <div className="admin-stack">
          <div className="admin-metric-row">
            <div className="admin-mini-metric"><span>Loaded products</span><strong>{products.length} / {totalProducts}</strong></div>
            <div className="admin-mini-metric"><span>Buyable SKUs</span><strong>{activeCount}</strong></div>
            <div className="admin-mini-metric"><span>Available stock</span><strong>{totalStock}</strong></div>
            <div className="admin-mini-metric"><span>Featured</span><strong>{featuredCount}</strong></div>
          </div>
          <div className="admin-table-toolbar">
            <label className="admin-search">
              <Search size={16} />
              <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search product, SKU, category" />
            </label>
            <span>{filteredProducts.length} visible</span>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table catalog-table">
              <thead><tr><th>Product</th><th>Collection</th><th>Variant</th><th>Price</th><th>Stock</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {filteredProducts.map(product => {
                  const variant = product.variants?.[0];
                  const stock = Number(product.available_qty || 0);
                  return (
                    <tr key={product.id}>
                      <td>
                        <div className="admin-product-cell">
                          <ProductVisual product={product} className="admin-thumb" />
                          <div>
                            <strong>{product.name}</strong>
                            <span>{product.cat} / {product.gender}</span>
                          </div>
                        </div>
                      </td>
                      <td>{product.collections?.[0]?.name || 'Default'}</td>
                      <td>
                        <strong>{variant?.sku || '-'}</strong>
                        <span className="admin-muted-line">{variant?.fabric || product.tags?.[0] || 'Pure silk'}</span>
                      </td>
                      <td>
                        <strong>{inr(product.price)}</strong>
                        {product.mrp > product.price && <span className="admin-muted-line">{inr(product.mrp)} MRP</span>}
                      </td>
                      <td>{stock}</td>
                      <td><span className={`status-badge ${stock > 0 && product.is_active !== false ? 'st-delivered' : 'st-pending'}`}>{stock > 0 && product.is_active !== false ? 'Live' : 'Out'}</span></td>
                      <td>
                        <div className="admin-row-actions">
                          <button type="button" onClick={() => void startEdit(product)} disabled={editLoading}>
                            <Pencil size={14} /> {editLoading && editingProduct?.id === product.id ? 'Loading...' : 'Edit'}
                          </button>
                          <button type="button" onClick={() => void deactivateProduct(product)}><Trash2 size={14} /> Deactivate</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!loading && filteredProducts.length === 0 && (
                  <tr><td colSpan={7}><div className="admin-empty-row">No products match your search. Add a product to publish to the store.</div></td></tr>
                )}
              </tbody>
            </table>
          </div>
          {page < totalPages && (
            <div className="admin-load-more-row">
              <span>Showing {products.length} of {totalProducts} products</span>
              <button className="admin-soft-btn" onClick={() => void loadCatalog(page + 1, true)} disabled={loadingMore}>
                <RefreshCw size={14} /> {loadingMore ? 'Loading...' : 'Load more products'}
              </button>
            </div>
          )}

          {editingProduct && editForm && (
            <div className="admin-edit-modal" role="dialog" aria-modal="true" aria-label={`Edit ${editingProduct.name}`}>
              <div className="admin-form-card admin-edit-panel">
                <div className="chart-title chart-title-between">
                  <span><Pencil size={18} /> Edit {editingProduct.name}</span>
                  <button type="button" className="admin-soft-btn" onClick={cancelEdit}>Cancel</button>
                </div>
                <div className="admin-form-grid">
                  <label className="admin-field wide">Product name<input value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} /></label>
                  <label className="admin-field wide">Selling line<input value={editForm.hook} onChange={e => setEditForm({ ...editForm, hook: e.target.value })} /></label>
                  <label className="admin-field">Deal label<input value={editForm.deal_label} onChange={e => setEditForm({ ...editForm, deal_label: e.target.value })} /></label>
                  <label className="admin-field">Selling price<input type="number" min="0" step="0.01" value={editForm.price} onChange={e => setEditForm({ ...editForm, price: e.target.value })} /></label>
                  <label className="admin-field">MRP<input type="number" min="0" step="0.01" value={editForm.mrp} onChange={e => setEditForm({ ...editForm, mrp: e.target.value })} /></label>
                  <label className="admin-field">Stock qty<input type="number" min="0" value={editForm.stock_qty} onChange={e => setEditForm({ ...editForm, stock_qty: e.target.value })} /></label>
                  <label className="admin-check"><input type="checkbox" checked={editForm.is_featured} onChange={e => setEditForm({ ...editForm, is_featured: e.target.checked })} /> Featured on home</label>
                  <label className="admin-check"><input type="checkbox" checked={editForm.is_active} onChange={e => setEditForm({ ...editForm, is_active: e.target.checked })} /> Active in store</label>
                </div>
                <button type="button" className="admin-primary-btn admin-submit" onClick={() => void saveEdit()} disabled={saving}>
                  <Save size={16} /> {saving ? 'Saving...' : 'Save product changes'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'add' && (
        <form className="admin-create-grid" onSubmit={createProduct}>
          <div className="admin-form-card">
            <div className="chart-title"><PackagePlus size={18} /> New product</div>
            <div className="admin-form-grid">
              <label className="admin-field wide">Product name<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Royal Kanjivaram Bridal Saree" /></label>
              <label className="admin-field">Slug<input value={form.slug} onChange={e => setForm({ ...form, slug: toSlug(e.target.value) })} placeholder={toSlug(form.name) || 'auto-created'} /></label>
              <label className="admin-field">Gender
                <AdminChoice
                  value={form.gender}
                  onChange={(value) => setForm({ ...form, gender: value })}
                  options={[
                    { value: 'women', label: 'Women' },
                    { value: 'men', label: 'Men' },
                    { value: 'unisex', label: 'Unisex' },
                  ]}
                />
              </label>
              <label className="admin-field">Category
                <input list="catalog-categories" value={form.category_name} onChange={e => setForm({ ...form, category_name: e.target.value })} />
              </label>
              <label className="admin-field">Collection
                <input list="catalog-collections" value={form.collection_name} onChange={e => setForm({ ...form, collection_name: e.target.value })} />
              </label>
              <label className="admin-field wide">Short selling line<input value={form.hook} onChange={e => setForm({ ...form, hook: e.target.value })} placeholder="Temple border pure silk with rich gold zari" /></label>
              <label className="admin-field wide">Description<textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Describe fabric, zari, blouse, occasion, and quality details." /></label>
            </div>

            <div className="admin-form-section">Pricing and SKU</div>
            <div className="admin-form-grid">
              <label className="admin-field">Selling price<input type="number" min="0" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} /></label>
              <label className="admin-field">MRP<input type="number" min="0" value={form.mrp} onChange={e => setForm({ ...form, mrp: e.target.value })} /></label>
              <label className="admin-field">Opening stock<input type="number" min="0" value={form.stock_qty} onChange={e => setForm({ ...form, stock_qty: e.target.value })} /></label>
              <label className="admin-field">SKU<input value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value.toUpperCase() })} placeholder="Auto if blank" /></label>
              <label className="admin-field">Color name<input value={form.color_name} onChange={e => setForm({ ...form, color_name: e.target.value })} /></label>
              <label className="admin-field color-field">Color swatch<input type="color" value={form.color_hex} onChange={e => setForm({ ...form, color_hex: e.target.value })} /></label>
              <label className="admin-field">Fabric<input value={form.fabric} onChange={e => setForm({ ...form, fabric: e.target.value })} /></label>
              <label className="admin-field">Zari type<input value={form.zari_type} onChange={e => setForm({ ...form, zari_type: e.target.value })} /></label>
            </div>

            <div className="admin-form-section">Merchandising</div>
            <div className="admin-form-grid">
              <label className="admin-field wide">Upload product photo<input type="file" accept="image/*" onChange={event => void uploadImage(event.target.files?.[0])} /></label>
              <label className="admin-field wide">Image URL<input value={form.image_url} onChange={e => setForm({ ...form, image_url: e.target.value })} placeholder="https://..." /></label>
              <label className="admin-field">Deal label<input value={form.deal_label} onChange={e => setForm({ ...form, deal_label: e.target.value })} /></label>
              <label className="admin-field">Tags<input value={form.tags_text} onChange={e => setForm({ ...form, tags_text: e.target.value })} /></label>
              <label className="admin-field">Occasions<input value={form.occasions_text} onChange={e => setForm({ ...form, occasions_text: e.target.value })} /></label>
              <label className="admin-check"><input type="checkbox" checked={form.is_featured} onChange={e => setForm({ ...form, is_featured: e.target.checked })} /> Featured on home</label>
              <label className="admin-check"><input type="checkbox" checked={form.blouse_included} onChange={e => setForm({ ...form, blouse_included: e.target.checked })} /> Blouse included</label>
            </div>

            <datalist id="catalog-categories">
              {categories.map(category => <option key={category.id} value={category.name} />)}
            </datalist>
            <datalist id="catalog-collections">
              {collections.map(collection => <option key={collection.id} value={collection.name} />)}
            </datalist>

            <button className="admin-primary-btn admin-submit" type="submit" disabled={saving || uploadingImage}>
              <Save size={16} /> {uploadingImage ? 'Uploading image...' : saving ? 'Publishing...' : 'Publish to customer store'}
            </button>
          </div>

          <aside className="admin-preview-panel">
            <div className="chart-title"><ImagePlus size={18} /> Customer preview</div>
            <ProductVisual product={previewProduct} className="admin-preview-visual" />
            <div className="admin-preview-copy">
              <span>{previewProduct.cat}</span>
              <strong>{previewProduct.name}</strong>
              <p>{previewProduct.hook || 'Pure silk textile from CSM Silks.'}</p>
              <div><b>{inr(previewProduct.price)}</b>{Number(previewProduct.mrp) > Number(previewProduct.price) && <em>{inr(previewProduct.mrp)}</em>}</div>
            </div>
            <div className="admin-preview-note">
              <CheckCircle2 size={18} /> Active product, live SKU stock, COD, returns, and CSM Assured are enabled.
            </div>
          </aside>
        </form>
      )}

      {tab === 'collections' && (
        <div className="admin-create-grid compact">
          <form className="admin-form-card" onSubmit={createCollection}>
            <div className="chart-title"><Layers3 size={18} /> New collection</div>
            <label className="admin-field wide">Collection name<input value={collectionForm.name} onChange={e => setCollectionForm({ ...collectionForm, name: e.target.value })} placeholder="Wedding Silk Edit" /></label>
            <label className="admin-field wide">Description<textarea value={collectionForm.description} onChange={e => setCollectionForm({ ...collectionForm, description: e.target.value })} placeholder="Short collection description for admin organization." /></label>
            <label className="admin-check"><input type="checkbox" checked={collectionForm.is_featured} onChange={e => setCollectionForm({ ...collectionForm, is_featured: e.target.checked })} /> Featured collection</label>
            <button className="admin-primary-btn admin-submit" type="submit" disabled={saving}><Sparkles size={16} /> Create collection</button>
          </form>
          <div className="admin-form-card">
            <div className="chart-title">Existing collections</div>
            <div className="admin-collection-list">
              {collections.map(collection => (
                <div key={collection.id} className="admin-collection-row">
                  <div>
                    <strong>{collection.name}</strong>
                    <span>{collection.description || collection.slug}</span>
                  </div>
                  {collection.is_featured && <span className="status-badge st-delivered">Featured</span>}
                </div>
              ))}
              {collections.length === 0 && <div className="admin-empty-row">No collections yet.</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
