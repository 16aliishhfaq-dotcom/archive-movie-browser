import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Clapperboard, ExternalLink, Film, LoaderCircle, LogOut, Pencil, Plus, Search, Trash2 } from 'lucide-react';

const EMPTY = { movie_name: '', category: '', poster: '', movie_link: '' };
async function readResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed (' + response.status + ')');
  return data;
}
function Login({ onLogin }) {
  const [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await readResponse(await fetch('/api/admin/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) }));
      onLogin();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <div className="min-h-screen bg-ink text-bone flex items-center justify-center p-5"><form onSubmit={submit} className="panel w-full max-w-md p-8">
    <div className="w-12 h-12 rounded-xl bg-signal text-ink flex items-center justify-center mb-7"><Clapperboard size={25} /></div>
    <p className="eyebrow mb-3">Orphaned Films · Private area</p><h1 className="display text-4xl">Admin sign in</h1>
    <p className="text-muted text-sm mt-3">Manage your Archive.org movie catalogue.</p>
    <label htmlFor="admin-password" className="label block mt-8 mb-2">Admin password</label>
    <input id="admin-password" type="password" autoComplete="current-password" autoFocus required value={password} onChange={e => setPassword(e.target.value)} className="w-full h-11 bg-ink border border-line rounded-lg px-3 text-bone" />
    {error && <p role="alert" className="text-red-300 text-sm mt-3">{error}</p>}
    <button className="btn-primary w-full mt-6" disabled={busy}>{busy ? <LoaderCircle size={16} className="animate-spin" /> : <Clapperboard size={16} />} Enter dashboard</button>
    <a href="/" className="block text-center text-muted hover:text-bone text-xs mt-6">← Back to website</a>
  </form></div>;
}
function MovieCard({ movie, onSave, onRemove }) {
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(EMPTY), [busy, setBusy] = useState(false), [error, setError] = useState('');
  function beginEdit() { setDraft({ movie_name: movie.movie_name, category: movie.category, poster: movie.poster, movie_link: movie.movie_link }); setError(''); setEditing(true); }
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await onSave(movie.id, draft); setEditing(false); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <article className="panel overflow-hidden"><div className="p-4 sm:p-5 flex gap-4">
    {movie.poster ? <img src={movie.poster} alt="" loading="lazy" className="w-20 sm:w-24 aspect-[2/3] object-cover rounded-md bg-ink shrink-0" /> : <div className="w-20 sm:w-24 aspect-[2/3] rounded-md bg-ink border border-line flex items-center justify-center shrink-0"><Film className="text-dim" /></div>}
    <div className="min-w-0 flex-1"><span className="label rounded-full px-2.5 py-1 border border-nitrate/40 text-nitrate">Visible on website</span>
      <h3 className="font-semibold text-bone text-base sm:text-lg mt-2 leading-snug break-words">{movie.movie_name}</h3><p className="text-xs text-muted mt-1">{movie.category}</p><p className="text-xs text-dim mt-1 break-all">{movie.movie_link}</p>
      <div className="flex flex-wrap gap-2 mt-4"><button onClick={beginEdit} className="btn-ghost h-9 px-3 text-[10px]"><Pencil size={13} /> Edit</button>
        <a href={movie.movie_link} target="_blank" rel="noreferrer" className="btn-ghost h-9 px-3 text-[10px]"><ExternalLink size={13} /> Archive.org</a>
        <button onClick={() => onRemove(movie)} className="btn-ghost h-9 px-3 text-[10px] text-red-300"><Trash2 size={13} /> Remove</button></div>
    </div>
  </div>
  {editing && <form onSubmit={save} className="border-t border-line bg-ink/60 p-4 sm:p-5 space-y-3"><p className="eyebrow">Edit movie fields</p>
    <input required maxLength={180} aria-label="Movie name" value={draft.movie_name} onChange={e => setDraft({ ...draft, movie_name: e.target.value })} placeholder="Movie name" className="admin-input" />
    <input required maxLength={100} aria-label="Category" value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })} placeholder="Category" className="admin-input" />
    <input required type="url" aria-label="Poster URL" value={draft.poster} onChange={e => setDraft({ ...draft, poster: e.target.value })} placeholder="Poster HTTPS URL" className="admin-input" />
    <input required type="url" aria-label="Movie link" value={draft.movie_link} onChange={e => setDraft({ ...draft, movie_link: e.target.value })} placeholder="https://archive.org/details/..." className="admin-input" />
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    <div className="flex gap-2"><button disabled={busy} className="btn-primary h-9 px-4 text-[10px]">{busy ? <LoaderCircle size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Save</button><button type="button" onClick={() => setEditing(false)} className="btn-ghost h-9 px-4 text-[10px]">Cancel</button></div>
  </form>}</article>;
}
export default function AdminPage() {
  const [loggedIn, setLoggedIn] = useState(false), [checking, setChecking] = useState(true), [movies, setMovies] = useState([]);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [itemInput, setItemInput] = useState('');
  const [preview, setPreview] = useState(null), [draft, setDraft] = useState(EMPTY), [previewBusy, setPreviewBusy] = useState(false), [addBusy, setAddBusy] = useState(false);
  const [query, setQuery] = useState(''), [redisEnabled, setRedisEnabled] = useState(false);
  const signOut = useCallback(() => { fetch('/api/admin/logout', { method: 'POST' }).catch(() => {}); setLoggedIn(false); setMovies([]); }, []);
  const load = useCallback(async () => {
    try { const data = await readResponse(await fetch('/api/admin/movies')); setMovies(data.movies || []); setError(''); }
    catch (err) { setError(err.message); if (err.message.includes('401')) signOut(); }
  }, [signOut]);
  useEffect(() => {
    document.title = 'Admin dashboard | Orphaned Films'; let active = true;
    fetch('/api/admin/session').then(r => { if (active) setLoggedIn(r.ok); }).catch(() => { if (active) setError('Could not connect to the admin service.'); }).finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!loggedIn) return;
    load();
    fetch('/api/admin/cache').then(r => r.ok ? r.json() : null).then(data => { if (data) setRedisEnabled(data.enabled === true); }).catch(() => {});
  }, [loggedIn, load]);
  async function previewArchiveItem(event) {
    event.preventDefault(); if (!itemInput.trim() || previewBusy) return;
    setPreviewBusy(true); setPreview(null); setError(''); setNotice('');
    try {
      const data = await readResponse(await fetch('/api/admin/archive-preview?item=' + encodeURIComponent(itemInput.trim())));
      setPreview(data.item); setDraft({ movie_name: data.item.movie_name, category: data.item.category, poster: data.item.poster, movie_link: data.item.movie_link });
    } catch (err) { setError(err.message); } finally { setPreviewBusy(false); }
  }
  async function addMovie(event) {
    event.preventDefault(); if (!preview || addBusy) return;
    setAddBusy(true); setError('');
    try {
      await readResponse(await fetch('/api/admin/movies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item: preview.identifier, ...draft }) }));
      setNotice('Movie added and is now visible on the website.'); setPreview(null); setItemInput(''); setDraft(EMPTY); await load();
    } catch (err) { setError(err.message); } finally { setAddBusy(false); }
  }
  async function saveMovie(id, values) {
    await readResponse(await fetch('/api/admin/movies/' + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) }));
    await load();
  }
  async function removeMovie(movie) {
    if (!window.confirm('Remove "' + movie.movie_name + '" from your website catalogue? The Archive.org item will not be deleted.')) return;
    try { await readResponse(await fetch('/api/admin/movies/' + movie.id, { method: 'DELETE' })); await load(); setNotice('Movie removed from website; Archive.org source remains untouched.'); }
    catch (err) { setError(err.message); }
  }
  const filtered = movies.filter(movie => (movie.movie_name + ' ' + movie.category + ' ' + movie.movie_link).toLowerCase().includes(query.toLowerCase().trim()));
  if (checking) return <div className="min-h-screen bg-ink text-bone flex items-center justify-center"><LoaderCircle className="animate-spin text-signal" /></div>;
  if (!loggedIn) return <Login onLogin={() => setLoggedIn(true)} />;
  return <div className="min-h-screen bg-ink text-bone">
    <header className="border-b border-line"><div className="max-w-7xl mx-auto px-4 sm:px-8 py-5 flex items-center justify-between gap-4">
      <a href="/" className="flex items-center gap-3 min-w-0"><span className="w-10 h-10 rounded-lg bg-signal text-ink flex items-center justify-center shrink-0"><Clapperboard size={21} /></span><span><span className="display block text-2xl leading-none">Orphaned Films</span><span className="label">Movie control room</span></span></a>
      <div className="flex items-center gap-3"><span className={'label rounded-full border px-3 py-2 ' + (redisEnabled ? 'border-nitrate/40 text-nitrate' : 'border-line text-muted')}>Redis cache {redisEnabled ? 'enabled' : 'not connected'}</span><a href="/" className="btn-ghost h-9 px-3 text-[10px] hidden sm:inline-flex">View site <ExternalLink size={13} /></a><button onClick={signOut} className="btn-ghost h-9 px-3 text-[10px]"><LogOut size={13} /> Sign out</button></div>
    </div></header>
    <main className="max-w-7xl mx-auto px-4 sm:px-8 py-8 sm:py-12">
      <div className="mb-8"><p className="eyebrow mb-3">Neon movie catalogue</p><h1 className="display text-5xl sm:text-6xl">Your movie library</h1><p className="text-muted mt-3">Add Archive.org links. Videos stay hosted on Archive.org and play on this website.</p></div>
      {notice && <div role="status" className="panel border-nitrate/40 text-nitrate p-4 mb-5 flex gap-3"><CheckCircle2 size={18} />{notice}</div>}
      {error && <div role="alert" className="panel border-red-400/40 text-red-200 p-4 mb-5 flex gap-3"><AlertCircle size={18} />{error}</div>}
      <section className="grid grid-cols-2 gap-3 mb-9"><div className="panel p-5"><span className="label">Movies in catalogue</span><p className="display text-4xl mt-5">{movies.length}</p></div><div className="panel p-5"><span className="label">Cache layer</span><p className="display text-2xl mt-5">{redisEnabled ? 'Redis active' : 'Waiting for Redis'}</p></div></section>
      <section className="panel p-5 sm:p-7 mb-10"><p className="eyebrow mb-2">Add an Archive.org movie</p><h2 className="display text-3xl">Add movie</h2><p className="text-sm text-muted mt-2 max-w-2xl leading-relaxed">Paste an Archive.org identifier or details link. We verify it and save only the five requested fields in Neon.</p>
        <form onSubmit={previewArchiveItem} className="mt-6 flex flex-col sm:flex-row gap-3"><label className="flex-1"><span className="label block mb-2">Archive.org link or identifier</span><input value={itemInput} onChange={e => { setItemInput(e.target.value); setPreview(null); }} placeholder="https://archive.org/details/..." className="admin-input" /></label><button disabled={previewBusy || !itemInput.trim()} className="btn-primary sm:self-end h-11 px-5">{previewBusy ? <LoaderCircle size={15} className="animate-spin" /> : <Search size={15} />} Preview movie</button></form>
        {preview && <form onSubmit={addMovie} className="mt-6 border-t border-line pt-6 space-y-3"><div className="flex gap-4 items-start"><img src={draft.poster} alt="" className="w-24 aspect-[2/3] object-cover rounded-md bg-ink" /><div><p className="eyebrow">Archive.org verified</p><h3 className="display text-2xl mt-1">{preview.movie_name}</h3><p className="text-xs text-muted mt-1 break-all">{preview.movie_link}</p></div></div>
          <label className="block"><span className="label block mb-2">Movie name</span><input required maxLength={180} value={draft.movie_name} onChange={e => setDraft({ ...draft, movie_name: e.target.value })} className="admin-input" /></label>
          <label className="block"><span className="label block mb-2">Category</span><input required maxLength={100} value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })} className="admin-input" /></label>
          <label className="block"><span className="label block mb-2">Poster URL</span><input required type="url" value={draft.poster} onChange={e => setDraft({ ...draft, poster: e.target.value })} className="admin-input" /></label>
          <label className="block"><span className="label block mb-2">Movie link</span><input required type="url" value={draft.movie_link} onChange={e => setDraft({ ...draft, movie_link: e.target.value })} className="admin-input" /></label>
          <div className="flex gap-2"><button disabled={addBusy} className="btn-primary h-10 px-5">{addBusy ? <LoaderCircle size={15} className="animate-spin" /> : <Plus size={15} />} Save movie</button><button type="button" onClick={() => setPreview(null)} className="btn-ghost h-10 px-4">Cancel</button></div>
        </form>}
      </section>
      <section><div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-5"><div><p className="eyebrow mb-2">Catalogue management</p><h2 className="display text-3xl">All movies</h2></div><label className="relative sm:w-72"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-dim" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search movies..." className="admin-input pl-9" /></label></div>
        {filtered.length ? <div className="grid lg:grid-cols-2 gap-4">{filtered.map(movie => <MovieCard key={movie.id} movie={movie} onSave={saveMovie} onRemove={removeMovie} />)}</div> : <div className="panel p-10 text-center"><Film size={28} className="mx-auto text-dim mb-3" /><p className="text-muted">{movies.length ? 'No movies match this search.' : 'No movies yet. Add your first Archive.org movie above.'}</p></div>}
      </section>
    </main>
  </div>;
}
