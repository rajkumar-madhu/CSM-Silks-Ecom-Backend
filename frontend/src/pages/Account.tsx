import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { useApp } from '@/store/AppContext';
import { CustomerAuth } from '@/pages/CustomerAuth';
import type { LoyaltyReward } from '@/types';

const NAME_MIN_LENGTH = 2;

function normalizeProfileName(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

function isValidProfileEmail(value: string) {
  if (!value.trim()) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function Account() {
  const { showToast, user, isAuthed, refreshSession, logout } = useApp();
  const navigate = useNavigate();
  const [rewards, setRewards] = useState<LoyaltyReward[]>([]);
  const [rewardsLoading, setRewardsLoading] = useState(false);
  const [redeemingId, setRedeemingId] = useState<number | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState({ full_name: '', email: '' });
  const [profileError, setProfileError] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  const initialProfile = useMemo(
    () => ({
      full_name: normalizeProfileName(user?.full_name || user?.name || ''),
      email: (user?.email || '').trim().toLowerCase(),
    }),
    [user?.email, user?.full_name, user?.name],
  );

  const normalizedForm = useMemo(
    () => ({
      full_name: normalizeProfileName(profileForm.full_name),
      email: profileForm.email.trim().toLowerCase(),
    }),
    [profileForm.email, profileForm.full_name],
  );

  const profileDirty = normalizedForm.full_name !== initialProfile.full_name || normalizedForm.email !== initialProfile.email;

  const loyaltyProgress = useMemo(() => {
    const points = user?.loyalty_points || 0;
    const nextReward = [...rewards]
      .filter(reward => reward.points_required > points)
      .sort((a, b) => a.points_required - b.points_required)[0];
    if (!nextReward) return 100;
    return Math.min(100, Math.round((points / nextReward.points_required) * 100));
  }, [rewards, user?.loyalty_points]);

  useEffect(() => {
    if (!isAuthed) return;
    void Promise.resolve()
      .then(() => {
        setRewardsLoading(true);
        return api.loyalty.rewards();
      })
      .then(setRewards)
      .catch(() => setRewards([]))
      .finally(() => setRewardsLoading(false));
  }, [isAuthed]);

  const openProfileEditor = () => {
    setProfileForm(initialProfile);
    setProfileError('');
    setEditingProfile(true);
  };

  const cancelProfileEditor = () => {
    setProfileForm(initialProfile);
    setProfileError('');
    setEditingProfile(false);
  };

  const saveProfile = async () => {
    const fullName = normalizedForm.full_name;
    const email = normalizedForm.email;
    if (fullName.length < NAME_MIN_LENGTH) {
      setProfileError('Enter your full name (minimum 2 characters).');
      return;
    }
    if (!isValidProfileEmail(email)) {
      setProfileError('Enter a valid email address.');
      return;
    }
    if (!profileDirty) {
      setProfileError('No changes to save.');
      return;
    }
    setProfileError('');
    setSavingProfile(true);
    try {
      await api.auth.updateMe({
        full_name: fullName,
        email: email || undefined,
      });
      await refreshSession();
      setEditingProfile(false);
      showToast('OK', 'Profile updated', 'Your account details are saved');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to save profile';
      setProfileError(message);
      showToast('!', 'Profile update failed', message);
    } finally {
      setSavingProfile(false);
    }
  };

  const redeemReward = async (reward: LoyaltyReward) => {
    setRedeemingId(reward.id);
    try {
      await api.loyalty.redeem(reward.id);
      await refreshSession();
      showToast('OK', 'Reward redeemed', `${reward.name} has been added to your account`);
    } catch (err) {
      showToast('!', 'Redeem failed', err instanceof Error ? err.message : 'Unable to redeem reward');
    } finally {
      setRedeemingId(null);
    }
  };

  if (!isAuthed) {
    return <CustomerAuth initialMode="login" />;
  }

  return (
    <div className="account-page">
      <div className="account-layout">
        <div className="account-sidebar">
          <div className="account-profile-card">
            {user?.avatar_url ? (
              <img className="apc-avatar-img" src={user.avatar_url} alt={user?.name || user?.full_name || 'Customer'} />
            ) : (
              <div className="apc-avatar">{(user?.name || user?.phone || 'C').slice(0, 1).toUpperCase()}</div>
            )}
            <div className="apc-name">{user?.name || user?.full_name || 'CSM Customer'}</div>
            <div className="apc-email">{user?.email || user?.phone}</div>
            {user?.phone && <div className="apc-meta">Phone {user.phone}</div>}
            {user?.avatar_url && <div className="apc-meta">Google account linked</div>}
            <div className="apc-tier">{(user?.loyalty_tier || 'bronze').toUpperCase()} MEMBER</div>
            <button
              className="account-edit-btn"
              type="button"
              onClick={() => {
                if (editingProfile) {
                  cancelProfileEditor();
                } else {
                  openProfileEditor();
                }
              }}
            >
              {editingProfile ? 'Close' : 'Edit profile'}
            </button>
          </div>
          <div className="account-nav">
            <button type="button" className="an-item on"><span className="an-ic">Pts</span>Loyalty & Points</button>
            <button type="button" className="an-item" onClick={() => navigate('/orders')}><span className="an-ic">Box</span>My Orders</button>
            <button type="button" className="an-item" onClick={() => navigate('/wishlist')}><span className="an-ic">Wish</span>Wishlist</button>
            <button type="button" className="an-item" onClick={() => void logout()}><span className="an-ic">Exit</span>Logout</button>
          </div>
        </div>

        <div>
          {editingProfile && (
            <form
              className="profile-edit-card"
              onSubmit={event => {
                event.preventDefault();
                void saveProfile();
              }}
            >
              <h2>Edit profile</h2>
              <div className="form-row">
                <div className="form-field">
                  <label>Full name</label>
                  <input
                    value={profileForm.full_name}
                    onChange={event => {
                      setProfileForm(prev => ({ ...prev, full_name: event.target.value }));
                      if (profileError) setProfileError('');
                    }}
                    placeholder="Your name"
                    autoComplete="name"
                    maxLength={120}
                  />
                </div>
                <div className="form-field">
                  <label>Email</label>
                  <input
                    value={profileForm.email}
                    onChange={event => {
                      setProfileForm(prev => ({ ...prev, email: event.target.value }));
                      if (profileError) setProfileError('');
                    }}
                    placeholder="you@example.com"
                    type="email"
                    autoComplete="email"
                  />
                </div>
              </div>
              {profileError && <div className="profile-form-error">{profileError}</div>}
              <div className="profile-edit-actions">
                <button className="btn btn-secondary" type="button" onClick={cancelProfileEditor} disabled={savingProfile}>Cancel</button>
                <button className="btn btn-gold" type="submit" disabled={savingProfile || !profileDirty}>
                  {savingProfile ? 'Saving...' : 'Save profile'}
                </button>
              </div>
            </form>
          )}

          <div className="loyalty-card">
            <div className="lc-tier">{(user?.loyalty_tier || 'bronze').toUpperCase()} MEMBER</div>
            <div className="lc-name">{user?.name || user?.full_name || 'CSM Customer'}</div>
            <div className="lc-pts-row"><div className="lc-pts">{user?.loyalty_points || 0}</div><div className="lc-pts-lbl">points</div></div>
            <div className="lc-worth">1 point = ₹1 checkout discount</div>
            <div className="lc-prog-labels"><span>Bronze</span><span>Elite benefits unlock with repeat orders</span></div>
            <div className="lc-prog"><div className="lc-prog-fill" style={{ width: `${loyaltyProgress}%` }} /></div>
          </div>

          <h3 style={{ fontFamily: 'var(--display)', fontSize: 22, fontWeight: 700, color: 'var(--ink)', marginBottom: 14 }}>Redeem Rewards</h3>
          {rewardsLoading ? (
            <div className="rewards-grid">
              {Array.from({ length: 4 }).map((_, index) => <div key={index} className="reward-skeleton" />)}
            </div>
          ) : rewards.length === 0 ? (
            <div className="reward-empty">No active rewards are available right now.</div>
          ) : (
            <div className="rewards-grid">
              {rewards.map((r) => {
                const disabled = (user?.loyalty_points || 0) < r.points_required || redeemingId === r.id;
                return (
                  <div key={r.id} className="reward-card">
                    <div className="rc-icon rc-gold">CSM</div>
                    <div>
                      <div className="rc-name">{r.name}</div>
                      <div className="rc-desc">{r.description}</div>
                    </div>
                    <div className="rc-right">
                      <div className="rc-pts">{Number(r.points_required).toLocaleString('en-IN')}</div>
                      <div className="rc-pts-lbl">points</div>
                      <button className="rc-btn" type="button" disabled={disabled} onClick={() => void redeemReward(r)}>
                        {redeemingId === r.id ? 'Redeeming...' : 'Redeem'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
