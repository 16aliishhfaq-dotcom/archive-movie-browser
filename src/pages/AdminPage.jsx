import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Clapperboard, ExternalLink, Eye, EyeOff, Film, LoaderCircle, LogOut, Pencil, Save, Upload } from 'lucide-react';

const EMPTY = { title: '', description: '', year: '', genre: '', posterUrl: '' };
const humanSize = n => n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
async function readResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed (' + response.status + ')');
  return data;
}
function Login({ onLogin }) {
  const [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const data = await readResponse(await fetch('/api/admin/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) }));
      onLogin();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <div className="min-h-screen bg-ink text-bone flex items-center justify-center p-5"><form onSubmit={submit} className="panel w-full max-w-md p-8">
    <div className="w-12 h-12 rounded-xl bg-signal text-ink flex items-center justify-center mb-7"><Clapperboard size={25} /></div>
    <p className="eyebrow mb-3">Orphaned Films · Private area</p><h1 className="display text-4xl">Admin sign in</h1><p className="text-muted text-sm mt-3">Sign in to manage your video library.</p>
    <label htmlFor="admin-password" className="label block mt-8 mb-2">Admin password</label><input id="admin-password" type="password" autoComplete="current-password" autoFocus required value={password} onChange={e => setPassword(e.target.value)} className="w-full h-11 bg-ink border border-line rounded-lg px-3 text-bone" />
    {error && <p role="alert" className="text-red-300 text-sm mt-3">{error}</p>}<button className="btn-primary w-full mt-6" disabled={busy}>{busy ? <LoaderCircle size={16} className="animate-spin" /> : <Clapperboard size={16} />}Enter dashboard</button>
    <a href="/" className="block text-center text-muted hover:text-bone text-xs mt-6">← Back to website</a>
  </form></div>;
}
function EditVideo({ video, onSaved }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [draft, setDraft] = useState({});
  function start() { setDraft({ title: video.title, description: video.description || '', year: video.year || '', genre: video.genre || '', poster_url: video.poster_url || '' }); setError(''); setOpen(true); }
  async function save(e) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      await readResponse(await fetch('/api/admin/videos/' + video.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) }));
      setOpen(false); await onSaved();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  if (!open) return <button onClick={start} className="btn-ghost h-9 px-3 text-[10px]"><Pencil size={13} /> Edit details</button>;
  return <form onSubmit={save} className="border-t border-line bg-ink/60 p-4 space-y-3">
    <p className="eyebrow">Edit video details</p><input required aria-label="Title" value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder="Title" className="admin-input" />
    <textarea aria-label="Description" rows={3} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} placeholder="Description" className="admin-input rounded-lg py-3" />
    <div className="grid grid-cols-2 gap-3"><input aria-label="Year" value={draft.year} onChange={e => setDraft({ ...draft, year: e.target.value })} placeholder="Year" className="admin-input" /><input aria-label="Genre" value={draft.genre} onChange={e => setDraft({ ...draft, genre: e.target.value })} placeholder="Genre" className="admin-input" /></div>
    <input aria-label="Poster URL" value={draft.poster_url} onChange={e => setDraft({ ...draft, poster_url: e.target.value })} placeholder="Poster HTTPS URL" className="admin-input" />
    {error && <p className="text-red-300 text-sm">{error}</p>}<div className="flex gap-2"><button disabled={busy} className="btn-primary h-9 px-4 text-[10px]"><Save size={13} />{busy ? 'Saving…' : 'Save'}</button><button type="button" onClick={() => setOpen(false)} className="btn-ghost h-9 px-4 text-[10px]">Cancel</button></div>
  </form>;
}
export default function AdminPage() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [checking, setChecking] = useState(true), [videos, setVideos] = useState([]), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState(0), [file, setFile] = useState(null), [rights, setRights] = useState(false), [form, setForm] = useState(EMPTY);
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
    let live = true;
    fetch('/api/admin/session')
      .then(response => { if (live) setLoggedIn(response.ok); })
      .catch(() => live && setError('Cannot reach the admin service.'))
      .finally(() => live && setChecking(false));
    return () => { live = false; };
  }, []);
  useEffect(() => { if (loggedIn) load(); }, [loggedIn, load]);
  function login() { setLoggedIn(true); }
  async function setPublished(video, published) {
    try {
      await readResponse(await fetch('/api/admin/videos/' + video.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ published }) }));
      await load(); setNotice(published ? 'Video is now published on the website.' : 'Video has been moved to drafts.');
      setTimeout(() => setNotice(''), 3500);
    } catch (err) { setError(err.message); }
  }
  function upload(e) {
    e.preventDefault(); if (!file || !form.title.trim() || !rights || busy) return;
    setBusy(true); setProgress(0); setError(''); setNotice('');
    const query = new URLSearchParams({ title: form.title, description: form.description, year: form.year, genre: form.genre, posterUrl: form.posterUrl, filename: file.name });
    const xhr = new XMLHttpRequest(); xhr.open('POST', '/api/admin/upload?' + query.toString());
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = e => { if (e.lengthComputable) setProgress(Math.round(e.loaded * 100 / e.total)); };
    xhr.onload = async () => {
      let data = {}; try { data = JSON.parse(xhr.responseText || '{}'); } catch { /* empty response */ }
      if (xhr.status >= 200 && xhr.status < 300) { setNotice('Upload complete. Video saved as a draft; publish it after reviewing the details.'); setForm(EMPTY); setFile(null); setRights(false); await load(); }
      else setError(data.error || 'Upload failed (' + xhr.status + ').');
      setBusy(false); setProgress(0);
    };
    xhr.onerror = () => { setError('Network error during upload. Try again.'); setBusy(false); };
    xhr.onabort = () => { setError('Upload cancelled.'); setBusy(false); };
    xhr.send(file);
  }
  const published = videos.filter(v => v.published && v.status === 'uploaded').length;
  const drafts = videos.filter(v => !v.published && v.status === 'uploaded').length;
  const totalBytes = videos.reduce((sum, v) => sum + (Number(v.file_size) || 0), 0);
  if (checking) return <div className="min-h-screen bg-ink text-bone flex items-center justify-center"><LoaderCircle className="animate-spin text-signal" /></div>;
  if (!loggedIn) return <Login onLogin={login} />;
  return <div className="min-h-screen bg-ink text-bone">
    <header className="border-b border-line"><div className="max-w-7xl mx-auto px-4 sm:px-8 py-5 flex items-center justify-between gap-4">
      <a href="/" className="flex items-center gap-3"><span className="w-10 h-10 rounded-lg bg-signal text-ink flex items-center justify-center"><Clapperboard size={21} /></span><span><span className="display block text-2xl leading-none">Orphaned Films</span><span className="label">Admin control room</span></span></a>
      <div className="flex items-center gap-2"><a href="/" className="btn-ghost h-9 px-3 text-[10px] hidden sm:inline-flex">View site <ExternalLink size={13} /></a><button onClick={signOut} className="btn-ghost h-9 px-3 text-[10px]"><LogOut size={13} /> Sign out</button></div>
    </div></header>
    <main className="max-w-7xl mx-auto px-4 sm:px-8 py-8 sm:py-12">
      <div className="mb-8"><p className="eyebrow mb-3">Private library management</p><h1 className="display text-5xl sm:text-6xl">Your video library</h1><p className="text-muted mt-3">Upload, organise and publish your own films.</p></div>
      {notice && <div role="status" className="panel border-nitrate/40 text-nitrate p-4 mb-5 flex gap-3"><CheckCircle2 size={18} />{notice}</div>}
      {error && <div role="alert" className="panel border-red-400/40 text-red-200 p-4 mb-5 flex gap-3"><AlertCircle size={18} />{error}</div>}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-9">
        {[[Film, 'Total videos', videos.length], [Eye, 'Published', published], [EyeOff, 'Drafts', drafts], [Upload, 'Storage uploaded', humanSize(totalBytes)]].map(([Icon, label, value]) => <div key={label} className="panel p-5"><div className="flex justify-between"><span className="label">{label}</span><Icon size={17} className="text-signal" /></div><p className="display text-4xl mt-5">{value}</p></div>)}
      </section>
      <section className="grid lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-8 items-start">
        <form onSubmit={upload} className="panel p-5 sm:p-7">
          <p className="eyebrow mb-2">Add to your collection</p><h2 className="display text-3xl">Upload a video</h2>
          <label className="block mt-6"><span className="label block mb-2">Video file *</span><input type="file" required accept=".mp4,.m4v,.mov,.webm,.mkv,.avi,.mpeg,.mpg,.ogv,video/*" onChange={e => setFile(e.target.files?.[0] || null)} className="block w-full text-sm text-muted file:mr-3 file:rounded-full file:border-0 file:bg-bone file:px-4 file:py-2.5 file:font-mono file:text-[10px] file:uppercase file:text-ink" /><span className="block text-xs text-dim mt-2">MP4, MOV, WebM, MKV, AVI, MPEG or OGV · max 95 MB.</span></label>
          {file && <p className="text-xs text-bone mt-3 rounded-lg bg-ink border border-line p-3">{file.name} · {humanSize(file.size)}</p>}
          <label className="block mt-5"><span className="label block mb-2">Title *</span><input required maxLength={180} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Enter video title" className="admin-input" /></label>
          <label className="block mt-4"><span className="label block mb-2">Description</span><textarea rows={3} maxLength={2000} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Short description" className="admin-input rounded-lg py-3" /></label>
          <div className="grid grid-cols-2 gap-3 mt-4">
            <label><span className="label block mb-2">Release year</span><input inputMode="numeric" maxLength={4} value={form.year} onChange={e => setForm({ ...form, year: e.target.value })} placeholder="1998" className="admin-input" /></label>
            <label><span className="label block mb-2">Genre</span><input maxLength={80} value={form.genre} onChange={e => setForm({ ...form, genre: e.target.value })} placeholder="Drama, Comedy…" className="admin-input" /></label>
          </div>
          <label className="block mt-4"><span className="label block mb-2">Poster image URL</span><input type="url" value={form.posterUrl} onChange={e => setForm({ ...form, posterUrl: e.target.value })} placeholder="https://…" className="admin-input" /></label>
          <label className="flex items-start gap-3 mt-5 text-xs text-muted"><input type="checkbox" checked={rights} onChange={e => setRights(e.target.checked)} className="mt-0.5 accent-orange-500" /><span>I own this video or have permission to upload and publish it.</span></label>
          {busy && <div className="mt-5"><div className="flex justify-between label mb-2"><span>Uploading to Internet Archive</span><span>{progress}%</span></div><div className="h-2 bg-ink rounded-full overflow-hidden"><div className="h-full bg-signal" style={{ width: progress + '%' }} /></div></div>}
          <button disabled={busy || !file || !form.title.trim() || !rights} className="btn-primary w-full mt-6">{busy ? <LoaderCircle size={16} className="animate-spin" /> : <Upload size={16} />}{busy ? 'Uploading…' : 'Upload as draft'}</button>
          <p className="text-xs text-dim mt-3">Videos stay unpublished until you choose to publish them.</p>
        </form>
        <section><div className="flex items-end justify-between gap-3 mb-4"><div><p className="eyebrow mb-2">Manage your collection</p><h2 className="display text-3xl">Uploaded videos</h2></div><button onClick={load} className="btn-ghost h-9 px-3 text-[10px]">Refresh</button></div>
          <div className="space-y-3">
            {videos.length === 0 && <div className="panel p-8 text-center"><Film className="mx-auto text-dim mb-3" size={28} /><p>Your library is empty</p><p className="text-muted text-sm mt-1">Your uploads will appear here.</p></div>}
            {videos.map(video => <article key={video.id} className="panel overflow-hidden"><div className="p-4 flex gap-4">
              {video.poster_url ? <img src={video.poster_url} alt="" className="w-20 aspect-[2/3] rounded-md object-cover bg-ink" /> : <div className="w-20 aspect-[2/3] rounded-md bg-ink flex items-center justify-center"><Film className="text-dim" /></div>}
              <div className="min-w-0 flex-1"><div className="flex flex-wrap gap-2 mb-2"><span className="label border border-line rounded-full px-2 py-1">{video.published ? 'Published' : 'Draft'}</span><span className="label border border-line rounded-full px-2 py-1">{video.status}</span></div>
                <h3 className="font-semibold break-words">{video.title}</h3><p className="text-xs text-muted mt-1">{[video.year, video.genre].filter(Boolean).join(' · ') || 'No year or genre'} · {humanSize(video.file_size)}</p><p className="text-xs text-dim mt-1 break-all">{video.identifier}</p>
                <div className="flex flex-wrap gap-2 mt-4"><EditVideo video={video} onSaved={load} />
                  {video.status === 'uploaded' && <button onClick={() => setPublished(video, !video.published)} className="btn-ghost h-9 px-3 text-[10px]">{video.published ? <><EyeOff size={13} /> Unpublish</> : <><Eye size={13} /> Publish</>}</button>}
                  <a href={video.archive_url} target="_blank" rel="noreferrer" className="btn-ghost h-9 px-3 text-[10px]"><ExternalLink size={13} /> Archive item</a></div>
              </div></div>{video.error && <p className="border-t border-line px-4 py-3 text-sm text-red-300">{video.error}</p>}</article>)}
          </div>
        </section>
      </section>
    </main>
    <footer className="border-t border-line mt-12"><div className="max-w-7xl mx-auto px-4 sm:px-8 py-5 text-xs text-dim flex justify-between"><span>Orphaned Films · Private admin</span><a href="/" className="hover:text-bone">Return to public site →</a></div></footer>
  </div>;
}
