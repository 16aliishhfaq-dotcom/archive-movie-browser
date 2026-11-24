import React, { useEffect, useState } from 'react';
import { ArrowUpRight, Film } from 'lucide-react';

export default function PublicUploads() {
  const [videos, setVideos] = useState([]);
  useEffect(() => {
    let active = true;
    fetch('/api/uploads')
      .then(response => response.ok ? response.json() : { videos: [] })
      .then(data => { if (active) setVideos(Array.isArray(data.videos) ? data.videos.slice(0, 8) : []); })
      .catch(() => {});
    return () => { active = false; };
  }, []);
  if (!videos.length) return null;
  return <section className="gutter pt-14">
    <div className="flex items-end justify-between gap-4 mb-6">
      <div>
        <p className="eyebrow mb-2">Selected from the Internet Archive</p>
        <h2 className="display text-3xl sm:text-4xl">Our picks from the Archive</h2>
        <p className="text-sm text-muted mt-2">Curated films, streamed from Archive.org in our player.</p>
      </div>
      <span className="label shrink-0">{videos.length} {videos.length === 1 ? 'film' : 'films'}</span>
    </div>
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3 sm:gap-4">
      {videos.map(video => <a key={video.id} href={'/browse#' + encodeURIComponent(video.identifier)} className="group min-w-0">
        <div className="film-frame bg-panel">
          {video.poster_url
            ? <img src={video.poster_url} alt="" loading="lazy" className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
            : <div className="w-full h-full flex items-center justify-center"><Film className="text-dim" size={28} /></div>}
          <span className="absolute bottom-2 right-2 w-7 h-7 rounded-full bg-signal text-ink flex items-center justify-center"><ArrowUpRight size={15} /></span>
        </div>
        <p className="text-sm font-medium text-bone mt-2 leading-snug line-clamp-2 group-hover:text-signal">{video.title}</p>
        <p className="text-xs text-dim mt-1">{[video.year, video.genre].filter(Boolean).join(' · ') || 'Archive.org film'}</p>
      </a>)}
    </div>
  </section>;
}
