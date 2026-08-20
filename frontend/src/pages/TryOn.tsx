import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, ShoppingCart, Sparkles } from 'lucide-react';
import { api, resolveAssetUrl } from '@/lib/api';
import { useApp } from '@/store/AppContext';
import { ProductVisual } from '@/ui/components';
import type { Product } from '@/types';

const skinOptions = [
  { label: 'Fair', color: '#F5D5B8' },
  { label: 'Wheatish', color: '#D4A574' },
  { label: 'Medium', color: '#C17F4A' },
  { label: 'Dusky', color: '#8B5A2B' },
  { label: 'Deep', color: '#5C3317' },
];

const bodyOptions = ['Petite', 'Regular', 'Tall', 'Plus'];
const drapeOptions = ['Nivi', 'Bengali', 'Gujarati', 'Coorgi', 'Nauvari', 'Kasavu', 'Madisar', 'Mumtaz'];

export function TryOn() {
  const navigate = useNavigate();
  const { addToCart, showToast } = useApp();
  const [skin, setSkin] = useState('Wheatish');
  const [body, setBody] = useState('Regular');
  const [drape, setDrape] = useState('Nivi');
  const [generated, setGenerated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestedProduct, setSuggestedProduct] = useState<Product | null>(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const [photoBase64, setPhotoBase64] = useState('');
  const [photoMediaType, setPhotoMediaType] = useState('image/jpeg');
  const [aiResult, setAiResult] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    api.products.list({ gender: 'women', featured: true, per_page: 1 })
      .then(async data => {
        if (data.items[0]) return data.items[0];
        const firstAvailable = await api.products.list({ gender: 'women', per_page: 1 });
        return firstAvailable.items[0] || null;
      })
      .then(setSuggestedProduct)
      .catch(() => setSuggestedProduct(null));
  }, []);

  const handlePhotoUpload = (file?: File) => {
    if (!file) return;
    setPhotoMediaType(file.type || 'image/jpeg');
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result || '');
      setPhotoPreview(value);
      setPhotoBase64(value.includes(',') ? value.split(',')[1] : value);
    };
    reader.readAsDataURL(file);
  };

  const handleGenerate = async () => {
    if (!photoBase64) {
      showToast('!', 'Photo required', 'Upload a customer photo to run AI virtual try-on');
      return;
    }
    setLoading(true);
    try {
      const result = await api.ai.tryon({
        product_id: suggestedProduct?.id,
        product_image_url: resolveAssetUrl(suggestedProduct?.images?.[0]),
        skin_tone: skin,
        body_type: body,
        drape_style: drape,
        occasion: 'occasion wear',
        user_photo_base64: photoBase64,
        user_photo_media_type: photoMediaType,
      });
      setAiResult(result);
      setGenerated(true);
      showToast('OK', result.result_image_url ? 'Virtual try-on ready' : 'AI styling ready', 'Your virtual try-on image and styling recommendations are ready');
    } catch (err) {
      showToast('!', 'Try-on failed', err instanceof Error ? err.message : 'Unable to generate try-on');
    } finally {
      setLoading(false);
    }
  };

  const addSuggested = async () => {
    if (!suggestedProduct) {
      showToast('!', 'No suggestion available', 'Browse the saree catalog to pick a live SKU');
      navigate('/womens');
      return;
    }
    await addToCart(suggestedProduct);
  };

  const downloadResult = () => {
    const url = aiResult?.result_image_url as string | undefined;
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = 'csm-silks-tryon.jpg';
    a.click();
  };

  return (
    <div className="tryon-page">
      <div className="tryon-shell">
        <div className="tryon-head">
          <button className="back-btn" onClick={() => navigate('/')} aria-label="Back home">
            <ArrowLeft size={18} />
            <span className="back-btn-label">Home</span>
          </button>
          <div>
            <span>Interactive studio</span>
            <h1>AI virtual try-on</h1>
          </div>
        </div>

        <div className="tryon-grid">
          <section className="tryon-controls" aria-label="Try-on controls">
            <div className="tryon-panel">
              <div className="tryon-panel-title">1. Select skin tone</div>
              <div className="skin-options">
                {skinOptions.map(option => (
                  <button key={option.label} type="button" className={`skin-choice ${skin === option.label ? 'on' : ''}`} onClick={() => setSkin(option.label)}>
                    <span style={{ background: option.color }} />
                    <strong>{option.label}</strong>
                  </button>
                ))}
              </div>
            </div>

            <div className="tryon-panel">
              <div className="tryon-panel-title">2. Body frame</div>
              <div className="pill-options">
                {bodyOptions.map(option => (
                  <button key={option} type="button" className={body === option ? 'on' : ''} onClick={() => setBody(option)}>
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <div className="tryon-panel">
              <div className="tryon-panel-title">3. Draping style</div>
              <div className="pill-options compact">
                {drapeOptions.map(option => (
                  <button key={option} type="button" className={drape === option ? 'on' : ''} onClick={() => setDrape(option)}>
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <div className="tryon-panel tryon-upload-panel">
              <div className="tryon-panel-title">4. Customer photo</div>
              <label className="tryon-upload">
                <input type="file" accept="image/*" onChange={event => handlePhotoUpload(event.target.files?.[0])} />
                {photoPreview ? <img src={photoPreview} alt="Customer try-on preview" /> : <span>Upload your photo for AI virtual try-on</span>}
              </label>
              <p>Upload a full-body photo. The AI will overlay the selected saree onto your image.</p>
            </div>

            <button className="tryon-generate" onClick={handleGenerate} disabled={loading} type="button">
              <Sparkles size={18} />
              {loading ? 'Generating virtual try-on...' : 'Try this saree on me'}
            </button>
          </section>

          <section className={`tryon-result ${generated ? 'ready' : ''}`} aria-live="polite">
            {!generated ? (
              <div className="tryon-placeholder">
                <Sparkles size={54} />
                <h2>Virtual try-on</h2>
                <p>Upload your photo and select a saree to see how it looks on you with AI-powered virtual try-on.</p>
              </div>
            ) : (
              <>
                {aiResult?.result_image_url ? (
                  <div className="tryon-image-result">
                    <div className="tryon-compare">
                      {photoPreview && (
                        <figure className="tryon-compare-fig">
                          <figcaption>You</figcaption>
                          <img src={photoPreview} alt="Your photo" />
                        </figure>
                      )}
                      <figure className="tryon-compare-fig tryon-compare-result">
                        <figcaption>Try-on result</figcaption>
                        <img src={String(aiResult.result_image_url)} alt="AI virtual try-on result" />
                      </figure>
                    </div>
                    <button className="tryon-download-btn" onClick={downloadResult} type="button">
                      <Download size={14} />
                      Download
                    </button>
                  </div>
                ) : (
                  <div className="tryon-score">
                    <span>AI match confidence</span>
                    <strong>{Number(aiResult?.confidence_score || 0)}%</strong>
                    <em>{String(aiResult?.provider || 'provider')} result</em>
                  </div>
                )}

                {(() => {
                  const verdict = String(aiResult?.ai_verdict || '');
                  const draping = String(aiResult?.draping_tip || '');
                  const blouse = String(aiResult?.blouse_suggestion || '');
                  const jewellery = String(aiResult?.jewellery_pairing || '');
                  const colour = String(aiResult?.colour_analysis || '');
                  if (!verdict && !draping && !blouse && !jewellery && !colour) return null;
                  return (
                    <div className="tryon-copy-card">
                      {verdict && <p>{verdict}</p>}
                      <dl>
                        {draping && (
                          <div>
                            <dt>Draping specification</dt>
                            <dd>{draping}</dd>
                          </div>
                        )}
                        {blouse && (
                          <div>
                            <dt>Blouse suggestion</dt>
                            <dd>{blouse}</dd>
                          </div>
                        )}
                        {jewellery && (
                          <div>
                            <dt>Accessory pairing</dt>
                            <dd>{jewellery}</dd>
                          </div>
                        )}
                        {colour && (
                          <div>
                            <dt>Colour analysis</dt>
                            <dd>{colour}</dd>
                          </div>
                        )}
                      </dl>
                    </div>
                  );
                })()}

                {suggestedProduct && (
                  <div className="tryon-suggestion">
                    <ProductVisual product={suggestedProduct} className="tryon-suggestion-img" />
                    <div>
                      <span>This saree</span>
                      <strong>{suggestedProduct.name}</strong>
                      <small>Rs {Number(suggestedProduct.price).toLocaleString('en-IN')}</small>
                    </div>
                  </div>
                )}

                <div className="tryon-actions">
                  <button type="button" onClick={() => navigate('/womens')}>Browse more sarees</button>
                  <button type="button" className="primary" onClick={() => void addSuggested()}>
                    <ShoppingCart size={16} />
                    Add to cart
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
