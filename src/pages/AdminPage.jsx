import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle, CheckCircle2, Clapperboard, ExternalLink, Eye, EyeOff,
  Film, LoaderCircle, LogOut, Pencil, Plus, RefreshCw, Search, Trash2,
} from 'lucide-react';

const EMPTY_EDIT = { title: '', description: '', year: '', genre: '', poster_url: '' };
const prettySize = value => {
  const size = Number(value) || 0;
  if (!size) return 'Size not listed';
  if (size < 1024 * 1024) return Math.round(size / 1024) + ' KB';
  if (size < 1024 * 1024 * 1024) return (size / (1024 * 1024)).toFixed(1) + ' MB';
  return (size / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
};
async function readResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed (' + response.status + ')');
  return data;
}

function Login({ onLogin }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await readResponse(await fetch('/api/admin/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      }));
      onLogin();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return <div className="min-h-screen bg-ink text-bone flex items-center justify-center p-5">
    <form onSubmit={submit} className="panel w-full max-w-md p-8">
      <div className="w-12 h-12 rounded-xl bg-signal text-ink flex items-center justify-center mb-7"><Clapperboard size={25} /></div>
      <p className="eyebrow mb-3">Orphaned Films · Private area</p>
      <h1 className="display text-4xl">Admin sign in</h1>
      <p className="text-muted text-sm mt-3">Curate Archive.org videos for the website.</p>
      <label htmlFor="admin-password" className="label block mt-8 mb-2">Admin password</label>
      <input id="admin-password" type="password" autoComplete="current-password" autoFocus required
        value={password} onChange={event => setPassword(event.target.value)}
        className="w-full h-11 bg-ink border border-line rounded-lg px-3 text-bone" />
      {error && <p role="alert" className="text-red-300 text-sm mt-3">{error}</p>}
      <button className="btn-primary w-full mt-6" disabled={busy}>
        {busy ? <LoaderCircle size={16} className="animate-spin" /> : <Clapperboard size={16} />}
        Enter dashboard
      </button>
      <a href="/" className="block text-center text-muted hover:text-bone text-xs mt-6">← Back to website</a>
    </form>
  </div>;
}

function EditListing({ video, onSave, onPublish, onRemove }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(EMPTY_EDIT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  function beginEdit() {
    setDraft({
      title: video.title,
      description: video.description || '',
      year: video.year || '',
      genre: video.genre || '',
      poster_url: video.poster_url || '',
    });
    setError('');
    setEditing(true);
  }
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSave(video.id, draft);
      setEditing(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return <article className="panel overflow-hidden">
    <div className="p-4 sm:p-5 flex gap-4">
      {video.poster_url
        ? <img src={video.poster_url} alt="" loading="lazy" className="w-20 sm:w-24 aspect-[2/3] object-cover rounded-md bg-ink shrink-0" />
        : <div className="w-20 sm:w-24 aspect-[2/3] rounded-md bg-ink border border-line flex items-center justify-center shrink-0"><Film className="text-dim" /></div>}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span className={'label rounded-full px-2.5 py-1 border ' + (video.published ? 'border-nitrate/40 text-nitrate' : 'border-line text-muted')}>
            {video.published ? 'Published on site' : 'Draft'}
          </span>
          <span className="label rounded-full px-2.5 py-1 border border-line text-muted">Archive.org source</span>
        </div>
        <h3 className="font-semibold text-bone text-base sm:text-lg leading-snug break-words">{video.title}</h3>
        <p className="text-xs text-muted mt-1">{[video.year, video.genre].filter(Boolean).join(' · ') || 'No year or genre'}</p>
        <p className="text-xs text-dim mt-1">{video.video_files} video file(s) · {prettySize(video.file_size)}{video.runtime ? ' · ' + video.runtime : ''}</p>
        <p className="text-xs text-dim mt-1 break-all">{video.identifier}</p>
        <div className="flex flex-wrap gap-2 mt-4">
          <button onClick={beginEdit} className="btn-ghost h-9 px-3 text-[10px]"><Pencil size={13} /> Edit details</button>
          <button onClick={() => onPublish(video, !video.published)} className="btn-ghost h-9 px-3 text-[10px]">
            {video.published ? <><EyeOff size={13} /> Unpublish</> : <><Eye size={13} /> Publish</>}
          </button>
          <a href={video.archive_url} target="_blank" rel="noreferrer" className="btn-ghost h-9 px-3 text-[10px]"><ExternalLink size={13} /> Archive item</a>
          <button onClick={() => onRemove(video)} className="btn-ghost h-9 px-3 text-[10px] text-red-300"><Trash2 size={13} /> Remove</button>
        </div>
      </div>
    </div>
    {editing && <form onSubmit={save} className="border-t border-line bg-ink/60 p-4 sm:p-5 space-y-3">
      <p className="eyebrow">Edit website display details</p>
      <input required maxLength={180} aria-label="Title" value={draft.title}
        onChange={event => setDraft({ ...draft, title: event.target.value })} placeholder="Title" className="admin-input" />
      <textarea maxLength={2000} aria-label="Description" rows={3} value={draft.description}
        onChange={event => setDraft({ ...draft, description: event.target.value })} placeholder="Description" className="admin-input rounded-lg py-3" />
      <div className="grid grid-cols-2 gap-3">
        <input aria-label="Year" inputMode="numeric" maxLength={4} value={draft.year}
          onChange={event => setDraft({ ...draft, year: event.target.value })} placeholder="Year" className="admin-input" />
        <input aria-label="Genre" maxLength={120} value={draft.genre}
          onChange={event => setDraft({ ...draft, genre: event.target.value })} placeholder="Genre" className="admin-input" />
      </div>
      <input aria-label="Poster URL" type="url" value={draft.poster_url}
        onChange={event => setDraft({ ...draft, poster_url: event.target.value })} placeholder="Poster HTTPS URL" className="admin-input" />
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      <div className="flex gap-2">
        <button disabled={busy} className="btn-primary h-9 px-4 text-[10px]">{busy ? <LoaderCircle size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}Save details</button>
        <button type="button" onClick={() => setEditing(false)} className="btn-ghost h-9 px-4 text-[10px]">Cancel</button>
      </div>
      <p className="text-xs text-dim">These edits change only the website catalogue, not the Archive.org item.</p>
    </form>}
  </article>;
}

export default function AdminPage() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [checking, setChecking] = useState(true);
  const [videos, setVideos] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [itemInput, setItemInput] = useState('');
  const [preview, setPreview] = useState(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');

  const signOut = useCallback(() => {
    fetch('/api/admin/logout', { method: 'POST' }).catch(() => {});
    setLoggedIn(false);
    setVideos([]);
  }, []);
  const load = useCallback(async () => {
    try {
      const data = await readResponse(await fetch('/api/admin/videos'));
      setVideos(data.videos || []);
      setError('');
    } catch (err) {
      setError(err.message);
      if (err.message.includes('401')) signOut();
    }
  }, [signOut]);

  useEffect(() => {
    document.title = 'Admin dashboard | Orphaned Films';
    let active = true;
    fetch('/api/admin/session')
      .then(response => { if (active) setLoggedIn(response.ok); })
      .catch(() => { if (active) setError('Could not connect to the admin service.'); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => { if (loggedIn) load(); }, [loggedIn, load]);

  function login() { setLoggedIn(true); }
  async function previewArchiveItem(event) {
    event.preventDefault();
    if (!itemInput.trim() || previewBusy) return;
    setPreviewBusy(true);
    setPreview(null);
    setError('');
    setNotice('');
    try {
      const data = await readResponse(await fetch('/api/admin/archive-preview?item=' + encodeURIComponent(itemInput.trim())));
      setPreview(data.item);
    } catch (err) {
      setError(err.message);
    } finally {
      setPreviewBusy(false);
    }
  }
  async function addArchiveItem() {
    if (!preview || addBusy) return;
    setAddBusy(true);
    setError('');
    try {
      await readResponse(await fetch('/api/admin/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item: preview.identifier }),
      }));
      setNotice('Archive.org item added as a draft. Publish it when you are ready.');
      setPreview(null);
      setItemInput('');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setAddBusy(false);
    }
  }
  async function saveItem(id, draft) {
    await readResponse(await fetch('/api/admin/videos/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    }));
    await load();
  }
  async function publishItem(video, published) {
    try {
      await readResponse(await fetch('/api/admin/videos/' + video.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ published }),
      }));
      await load();
      setNotice(published ? 'Video is now visible on the website.' : 'Video has been unpublished on the website.');
      setTimeout(() => setNotice(''), 3500);
    } catch (err) {
      setError(err.message);
    }
  }
  async function removeItem(video) {
    const confirmed = window.confirm(
      'Remove "' + video.title + '" from this website? The Archive.org item and its files will not be deleted.'
    );
    if (!confirmed) return;
    try {
      await readResponse(await fetch('/api/admin/videos/' + video.id, { method: 'DELETE' }));
      await load();
      setNotice('Removed from this website. The Archive.org item remains untouched.');
      setTimeout(() => setNotice(''), 3500);
    } catch (err) {
      setError(err.message);
    }
  }

  const published = videos.filter(video => video.published).length;
  const drafts = videos.length - published;
  const filtered = videos.filter(video => {
    if (filter === 'published' && !video.published) return false;
    if (filter === 'drafts' && video.published) return false;
    const text = (video.title + ' ' + video.identifier + ' ' + (video.genre || '')).toLowerCase();
    return text.includes(query.toLowerCase().trim());
  });

  if (checking) return <div className="min-h-screen bg-ink text-bone flex items-center justify-center"><LoaderCircle className="animate-spin text-signal" /></div>;
  if (!loggedIn) return <Login onLogin={login} />;

  return <div className="min-h-screen bg-ink text-bone">
    <header className="border-b border-line">
      <div className="max-w-7xl mx-auto px-4 sm:px-8 py-5 flex items-center justify-between gap-4">
        <a href="/" className="flex items-center gap-3 min-w-0">
          <span className="w-10 h-10 rounded-lg bg-signal text-ink flex items-center justify-center shrink-0"><Clapperboard size={21} /></span>
          <span><span className="display block text-2xl leading-none">Orphaned Films</span><span className="label">Archive.org control room</span></span>
        </a>
        <div className="flex items-center gap-2">
          <a href="/" className="btn-ghost h-9 px-3 text-[10px] hidden sm:inline-flex">View site <ExternalLink size={13} /></a>
          <button onClick={signOut} className="btn-ghost h-9 px-3 text-[10px]"><LogOut size={13} /> Sign out</button>
        </div>
      </div>
    </header>
    <main className="max-w-7xl mx-auto px-4 sm:px-8 py-8 sm:py-12">
      <div className="mb-8">
        <p className="eyebrow mb-3">Private library management</p>
        <h1 className="display text-5xl sm:text-6xl">Your video library</h1>
        <p className="text-muted mt-3">Curate Archive.org items. Videos stay hosted on Archive.org and play in our website.</p>
      </div>
      {notice && <div role="status" className="panel border-nitrate/40 text-nitrate p-4 mb-5 flex gap-3"><CheckCircle2 size={18} />{notice}</div>}
      {error && <div role="alert" className="panel border-red-400/40 text-red-200 p-4 mb-5 flex gap-3"><AlertCircle size={18} />{error}</div>}

      <section className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-9">
        {[[Film, 'Curated items', videos.length], [Eye, 'Published on website', published], [EyeOff, 'Drafts', drafts]].map(([Icon, label, value]) =>
          <div key={label} className="panel p-5">
            <div className="flex justify-between"><span className="label">{label}</span><Icon size={17} className="text-signal" /></div>
            <p className="display text-4xl mt-5">{value}</p>
          </div>
        )}
      </section>

      <section className="panel p-5 sm:p-7 mb-10">
        <p className="eyebrow mb-2">Add an existing Archive.org movie</p>
        <h2 className="display text-3xl">Curate a film</h2>
        <p className="text-sm text-muted mt-2 max-w-2xl leading-relaxed">
          Paste an Archive.org item identifier or details link. We will check its metadata and video files before adding it. Nothing is uploaded or copied.
        </p>
        <form onSubmit={previewArchiveItem} className="mt-6 flex flex-col sm:flex-row gap-3">
          <label className="flex-1">
            <span className="label block mb-2">Archive.org link or identifier</span>
            <input value={itemInput} onChange={event => { setItemInput(event.target.value); setPreview(null); }}
              placeholder="https://archive.org/details/..." className="admin-input" required />
          </label>
          <button disabled={previewBusy || !itemInput.trim()} className="btn-primary sm:self-end h-11 px-5">
            {previewBusy ? <LoaderCircle size={16} className="animate-spin" /> : <Search size={16} />}
            {previewBusy ? 'Checking Archive.org…' : 'Preview item'}
          </button>
        </form>

        {preview && <div className="mt-6 rounded-xl border border-line bg-ink/60 p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row gap-4">
            <img src={preview.poster_url} alt="" className="w-28 aspect-[2/3] object-cover rounded-md bg-panel shrink-0" />
            <div className="min-w-0 flex-1">
              <span className="label text-nitrate">Archive.org item verified</span>
              <h3 className="display text-2xl mt-2 break-words">{preview.title}</h3>
              <p className="text-xs text-muted mt-2">{[preview.year, preview.genre].filter(Boolean).join(' · ') || 'No year or subjects in Archive.org metadata'}</p>
              <p className="text-xs text-dim mt-1">{preview.video_files} video file(s) · {prettySize(preview.file_size)}{preview.runtime ? ' · ' + preview.runtime : ''}</p>
              {preview.description && <p className="text-sm text-muted mt-3 leading-relaxed">{preview.description}</p>}
              <a href={preview.archive_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-signal hover:underline mt-3">Open original item <ExternalLink size={12} /></a>
              <div className="flex flex-wrap gap-2 mt-4">
                <button onClick={addArchiveItem} disabled={addBusy} className="btn-primary h-10 px-4">
                  {addBusy ? <LoaderCircle size={15} className="animate-spin" /> : <Plus size={15} />}
                  {addBusy ? 'Adding…' : 'Add to website as draft'}
                </button>
                <button onClick={() => setPreview(null)} className="btn-ghost h-10 px-4 text-[10px]">Cancel</button>
              </div>
              <p className="text-xs text-amber-200/80 mt-3 leading-relaxed">
                Archive.org items are public at their source. Draft only hides this listing from our website.
              </p>
            </div>
          </div>
        </div>}
      </section>

      <section>
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-4">
          <div><p className="eyebrow mb-2">Manage website listings</p><h2 className="display text-3xl">Curated Archive.org films</h2></div>
          <button onClick={load} className="btn-ghost h-9 px-3 text-[10px]"><RefreshCw size={13} /> Refresh</button>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <label className="flex-1 relative">
            <span className="sr-only">Search curated items</span>
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-dim" />
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search title, identifier or genre" className="admin-input pl-9" />
          </label>
          <div className="flex gap-2">
            {['all', 'published', 'drafts'].map(value =>
              <button key={value} onClick={() => setFilter(value)}
                className={'btn-ghost h-11 px-4 text-[10px] ' + (filter === value ? 'border-signal text-signal' : '')}>
                {value === 'all' ? 'All' : value === 'published' ? 'Published' : 'Drafts'}
              </button>
            )}
          </div>
        </div>
        <div className="space-y-3">
          {filtered.length === 0 && <div className="panel p-8 text-center">
            <Film className="mx-auto text-dim mb-3" size={28} />
            <p className="text-bone font-medium">{videos.length ? 'No matching films' : 'No curated films yet'}</p>
            <p className="text-muted text-sm mt-1">{videos.length ? 'Try another search or filter.' : 'Add an Archive.org item above to start your website library.'}</p>
          </div>}
          {filtered.map(video => <EditListing key={video.id} video={video} onSave={saveItem} onPublish={publishItem} onRemove={removeItem} />)}
        </div>
      </section>
    </main>
    <footer className="border-t border-line mt-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-8 py-5 text-xs text-dim flex justify-between gap-3">
        <span>Orphaned Films · Archive.org curation</span><a href="/" className="hover:text-bone">Return to website →</a>
      </div>
    </footer>
  </div>;
}
