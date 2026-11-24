import React, { useEffect, useState } from 'react';
import { ArrowUpRight, Film } from 'lucide-react';

function archiveIdentifier(link) {
  try {
    const url = new URL(link);
    if (!['archive.org', 'www.archive.org'].includes(url.hostname.toLowerCase())) return '';
    const parts = url.pathname.split('/').filter(Boolean);
    return ['details', 'embed'].includes(parts[0]) ? parts[1] || '' : '';
  } catch { return ''; }
}
export default function PublicUploads() {
  const [movies, setMovies] = useState([]);
  useEffect(() => {
    let active = true;
    fetch('/api/uploads').then(response => response.ok ? response.json() : { movies: [] })
      .then(data => { if (active) setMovies(Array.isArray(data.movies) ? data.movies.slice(0, 8) : []); }).catch(() => {});
    return () => { active = false; };
  }, []);
  if (!movies.length) return null;
  return <section className="gutter pt-14">
    <div className="flex items-end justify-between gap-4 mb-6"><div><p className="eyebrow mb-2">Selected from the Internet Archive</p><h2 className="display text-3xl sm:text-4xl">Our picks from the Archive</h2><p className="text-sm text-muted mt-2">Curated movies, streamed from Archive.org in our player.</p></div><span className="label shrink-0">{movies.length} {movies.length === 1 ? 'movie' : 'movies'}</span></div>
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3 sm:gap-4">
      {movies.map(movie => {
        const identifier = archiveIdentifier(movie.movie_link);
        return <a key={movie.id} href={identifier ? '/browse#' + encodeURIComponent(identifier) : movie.movie_link} className="group min-w-0">
          <div className="film-frame bg-panel">{movie.poster ? <img src={movie.poster} alt="" loading="lazy" className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" /> : <div className="w-full h-full flex items-center justify-center"><Film className="text-dim" size={28} /></div>}
            <span className="absolute bottom-2 right-2 w-7 h-7 rounded-full bg-signal text-ink flex items-center justify-center"><ArrowUpRight size={15} /></span></div>
          <p className="text-sm font-medium text-bone mt-2 leading-snug line-clamp-2 group-hover:text-signal">{movie.movie_name}</p><p className="text-xs text-dim mt-1">{movie.category || 'Archive.org movie'}</p>
        </a>;
      })}
    </div>
  </section>;
}
