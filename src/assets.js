'use strict'

const fs = require('fs/promises')
const path = require('path')

const DEFAULT_CSS = `/* Label Site Generator — Default Theme */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --brand-dark: #0c0032;
  --brand-light: #cacadb;
  --brand-mid: #3a3a6e;
  --brand-accent: #5a5a9e;

  --bg: #f7f7fa;
  --surface: #ffffff;
  --border: #dcdce8;
  --text: #0c0032;
  --text-muted: #6b6b8a;
  --accent: #0c0032;
  --accent-hover: #3a3a6e;
  --header-bg: #0c0032;
  --header-border: #1e1e5a;
  --footer-bg: #0c0032;
  --max-width: 1200px;
}

body {
  background: var(--bg);
  color: var(--text);
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 16px;
  line-height: 1.65;
}

a { color: inherit; text-decoration: none; }
a:hover { color: var(--accent-hover); text-decoration: underline; }

/* ── Site Hero (banner + overlapping logo) ── */
.site-hero {
  position: relative;
  width: 100%;
  background: var(--brand-dark);
  overflow: visible;
}

.site-hero-banner {
  width: 100%;
  height: 260px;
  object-fit: cover;
  object-position: center;
  display: block;
}

.site-hero-logo {
  position: absolute;
  bottom: -120px;
  left: 10%;
  width: 300px;
  height: 300px;
  border-radius: 50%;
  border: 5px solid var(--surface);
  box-shadow: 0 6px 28px rgba(12,0,50,0.45);
  background: var(--surface);
  object-fit: cover;
  z-index: 110;
}

/* ── Sticky nav bar ── */
.site-header {
  position: sticky;
  top: 0;
  z-index: 100;
  background: var(--brand-dark);
  border-bottom: 1px solid var(--header-border);
}

.header-inner {
  max-width: var(--max-width);
  margin: 0 auto;
  padding: 0 2rem;
  height: 56px;
  display: flex;
  align-items: center;
  gap: 1.5rem;
}

.site-logo {
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  white-space: nowrap;
  flex-shrink: 0;
  color: var(--brand-light);
}

.site-nav {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  margin-left: auto;
}

.nav-item {
  position: relative;
  cursor: pointer;
  white-space: nowrap;
}

/* Both wrapper-style and direct-link nav items */
.nav-item > a,
.nav-item.has-dropdown > a,
a.nav-item {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.85rem;
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: #ffffff;
  border: 1px solid rgba(202,202,219,0.4);
  border-radius: 2rem;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}

.nav-item > a:hover,
.nav-item.has-dropdown > a:hover,
a.nav-item:hover {
  background: rgba(202,202,219,0.2);
  border-color: #ffffff;
  color: #ffffff;
  text-decoration: none;
}

.has-dropdown { position: relative; }

/* Invisible bridge prevents gap between nav item and dropdown from closing it */
.has-dropdown::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  height: 8px;
}

.has-dropdown:hover .dropdown { display: block; }

.dropdown {
  display: none;
  position: absolute;
  top: 100%;
  left: 0;
  background: var(--brand-dark);
  border: 1px solid var(--header-border);
  border-radius: 6px;
  min-width: 190px;
  box-shadow: 0 8px 24px rgba(12,0,50,0.4);
  z-index: 200;
  padding: 0.4rem 0;
  margin-top: 0;
}

.has-dropdown:hover .dropdown { display: block; }

.dropdown a {
  display: block;
  padding: 0.5rem 1rem;
  font-size: 0.85rem;
  color: var(--brand-light);
}

.dropdown a:hover { background: rgba(202,202,219,0.1); color: #fff; text-decoration: none; }

.nav-toggle {
  display: none;
  background: none;
  border: 1px solid var(--brand-light);
  border-radius: 4px;
  color: var(--brand-light);
  font-size: 1.2rem;
  cursor: pointer;
  margin-left: auto;
  padding: 0.2rem 0.5rem;
}

/* Spacer so content doesn't hide under the overlapping logo */
.hero-spacer { height: 144px; }

/* ── Main ── */
main { min-height: 60vh; }

/* ── Sections ── */
.section { padding: 4rem 2rem; }
.section:nth-child(even) { background: var(--surface); }

.section-inner {
  max-width: var(--max-width);
  margin: 0 auto;
}

.section h2 {
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  margin-bottom: 2rem;
  padding-bottom: 0.75rem;
  border-bottom: 2px solid var(--text);
}

/* ── Grids ── */
.release-grid, .artist-grid {
  display: grid;
  gap: 1.75rem;
}

.release-grid { grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
.artist-grid  { grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }

.release-card, .artist-card {
  display: block;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  overflow: hidden;
  transition: box-shadow 0.2s, transform 0.2s;
  text-decoration: none;
  color: var(--text);
}

.release-card:hover, .artist-card:hover {
  box-shadow: 0 4px 16px rgba(0,0,0,0.1);
  transform: translateY(-2px);
  text-decoration: none;
}

.release-card img, .artist-card img,
.artwork-placeholder {
  width: 100%;
  aspect-ratio: 1 / 1;
  object-fit: cover;
  display: block;
  background: var(--border);
}

.card-body {
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.release-title, .artist-name {
  font-size: 1rem;
  font-weight: 600;
  line-height: 1.3;
}

.release-artist, .artist-location {
  font-size: 0.85rem;
  color: var(--text-muted);
}

/* ── View all link ── */
.view-all {
  margin-top: 2rem;
  text-align: center;
}

.view-all a {
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  border-bottom: 2px solid var(--text);
  padding-bottom: 2px;
}

/* ── News section ── */
.news-placeholder {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1rem;
}

.news-placeholder p {
  font-size: 1rem;
  color: var(--text-muted);
}

.btn {
  display: inline-block;
  padding: 0.6rem 1.5rem;
  background: var(--text);
  color: #fff;
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  border-radius: 2px;
  text-decoration: none;
}

.btn:hover { background: var(--accent-hover); text-decoration: none; color: #fff; }

/* ── About section ── */
.social-links {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  margin-top: 1rem;
}

.social-links a {
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  border-bottom: 1px solid var(--border);
  padding-bottom: 2px;
}

/* ── Releases section ── */
.releases-section { background: var(--bg); }
.releases-section .release-artist {
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text);
}
.releases-section .release-title {
  font-size: 0.8rem;
  font-weight: 400;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

/* ── Artist Gallery ── */
.artist-gallery { margin-bottom: 2rem; }
.artist-gallery h2 {
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  margin-bottom: 1.5rem;
  padding-bottom: 0.5rem;
  border-bottom: 2px solid var(--text);
}
.gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 0.75rem;
}
.gallery-thumb {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  overflow: hidden;
  border-radius: 4px;
  aspect-ratio: 1 / 1;
}
.gallery-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 0.2s;
}
.gallery-thumb:hover img { transform: scale(1.04); }

/* ── Lightbox ── */
.lightbox {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.92);
  z-index: 1000;
  align-items: center;
  justify-content: center;
}
.lightbox.open { display: flex; }
.lightbox img {
  max-width: 90vw;
  max-height: 90vh;
  object-fit: contain;
  border-radius: 2px;
}
.lightbox-close {
  position: absolute;
  top: 1rem;
  right: 1.5rem;
  background: none;
  border: none;
  color: #fff;
  font-size: 2.5rem;
  cursor: pointer;
  line-height: 1;
  opacity: 0.8;
}
.lightbox-close:hover { opacity: 1; }
.lightbox-prev, .lightbox-next {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  color: #fff;
  font-size: 3rem;
  cursor: pointer;
  padding: 0 1rem;
  opacity: 0.7;
  line-height: 1;
}
.lightbox-prev:hover, .lightbox-next:hover { opacity: 1; }
.lightbox-prev { left: 0.5rem; }
.lightbox-next { right: 0.5rem; }

/* ── Artist Hero ── */
.artist-hero { position: relative; overflow: visible; }

.artist-hero-bg-clip {
  overflow: hidden;
  width: 100%;
  height: 420px;
}

.artist-hero-bg {
  width: 100%;
  height: 100%;
  background-image: var(--artist-photo);
  background-size: cover;
  background-position: center;
  filter: blur(18px) brightness(0.45);
  transform: scale(1.08);
}

.artist-hero-overlay {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 2rem 2rem 5rem;
  background: linear-gradient(to top, rgba(12,0,50,0.75) 0%, transparent 100%);
  pointer-events: none;
}
.artist-hero-logo-link {
  position: absolute;
  bottom: -120px;
  left: 10%;
  display: block;
  z-index: 110;
}

.artist-hero-name {
  font-size: 2.5rem;
  font-weight: 800;
  color: #fff;
  margin: 0 0 0.25rem;
  text-shadow: 0 2px 12px rgba(0,0,0,0.6);
}
.artist-hero-location {
  font-size: 0.9rem;
  color: var(--brand-light);
  margin: 0;
  opacity: 0.85;
}

@media (max-width: 640px) {
  .artist-hero-bg-clip { height: 260px; }
  .artist-hero-name { font-size: 1.75rem; }
  .artist-hero-overlay { padding: 1.5rem 1rem 4rem; }
  .artist-hero-logo-link { bottom: -60px; left: 5%; }
}

/* ── Artist page ── */
.artist-page { max-width: var(--max-width); margin: 0 auto; padding: 3rem 2rem; }

.artist-header {
  display: flex;
  gap: 2rem;
  align-items: flex-start;
  margin-bottom: 2.5rem;
  flex-wrap: wrap;
}

.artist-photo {
  width: 240px;
  height: 240px;
  object-fit: cover;
  border-radius: 4px;
  flex-shrink: 0;
}

.artist-header-text h1 { font-size: 2rem; font-weight: 800; margin-bottom: 0.5rem; }
.artist-location { color: var(--text-muted); font-size: 0.9rem; }

.artist-bio { margin-bottom: 2rem; }
.artist-links { margin-bottom: 2rem; }
.artist-links ul { list-style: none; display: flex; gap: 0.5rem; flex-wrap: wrap; }
.artist-links a {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.9rem;
  border: 1px solid var(--brand-mid);
  border-radius: 2rem;
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--brand-dark);
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.artist-links a:hover {
  background: var(--brand-dark);
  color: var(--brand-light);
  border-color: var(--brand-dark);
  text-decoration: none;
}

.discography h2 {
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  margin-bottom: 1.5rem;
  padding-bottom: 0.5rem;
  border-bottom: 2px solid var(--text);
}

/* ── Album page ── */
.album-page { max-width: var(--max-width); margin: 0 auto; padding: 3rem 2rem; }

.breadcrumb {
  font-size: 0.8rem;
  color: var(--text-muted);
  margin-bottom: 2rem;
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.breadcrumb a { color: var(--text-muted); }
.breadcrumb a:hover { color: var(--text); }

.album-header {
  display: flex;
  gap: 2rem;
  align-items: flex-start;
  margin-bottom: 2.5rem;
  flex-wrap: wrap;
}

.album-artwork {
  width: 280px;
  height: 280px;
  object-fit: cover;
  border-radius: 4px;
  flex-shrink: 0;
}

.album-header-text h1 { font-size: 1.75rem; font-weight: 800; margin-bottom: 0.5rem; }
.album-artist { color: var(--text-muted); margin-bottom: 1rem; }
.album-artist a { color: var(--text-muted); border-bottom: 1px solid var(--border); }

.bandcamp-embed { margin-bottom: 2rem; }
.bandcamp-embed iframe { width: 100%; border: 0; height: 42px; }
.bandcamp-link { margin-bottom: 2rem; }
.bandcamp-link a { font-weight: 600; border-bottom: 2px solid var(--text); padding-bottom: 2px; }

/* ── Videos ── */
.album-videos { margin-bottom: 2rem; }
.album-videos h2 {
  font-size: 0.9rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 0.75rem;
  color: var(--text-muted);
}
.video-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1.25rem;
}
.video-grid-single {
  grid-template-columns: 1fr;
}
  gap: 1.25rem;
}
.video-item iframe {
  width: 100%;
  aspect-ratio: 16 / 9;
  border: 0;
  border-radius: 4px;
  display: block;
}
.video-title {
  font-size: 0.8rem;
  color: var(--text-muted);
  margin-top: 0.4rem;
}

/* ── Physical Release ── */
.physical-release { margin-bottom: 2rem; }
.physical-release h2 {
  font-size: 0.9rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 0.75rem;
  color: var(--text-muted);
}
.physical-formats {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}
.format-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.3rem 0.8rem;
  background: var(--brand-dark);
  color: var(--brand-light);
  border-radius: 2rem;
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.04em;
}
.format-badge i { font-size: 0.9rem; }
.physical-links {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.physical-links li a {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.9rem;
  border: 1px solid var(--brand-mid);
  border-radius: 2rem;
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--brand-dark);
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.physical-links li a:hover {
  background: var(--brand-dark);
  color: var(--brand-light);
  border-color: var(--brand-dark);
  text-decoration: none;
}

/* ── Streaming links ── */
.streaming-links { margin-bottom: 2rem; }
.streaming-links h2 {
  font-size: 0.9rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 0.75rem;
  color: var(--text-muted);
}
.streaming-list {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.streaming-list li a {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.9rem;
  border: 1px solid var(--brand-mid);
  border-radius: 2rem;
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--brand-dark);
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.streaming-list li a:hover {
  background: var(--brand-dark);
  color: var(--brand-light);
  border-color: var(--brand-dark);
  text-decoration: none;
}
.streaming-list li a i { font-size: 0.95rem; }

.album-description { margin-bottom: 1.5rem; text-align: justify; }

.album-release-date {
  font-size: 0.8rem;
  color: var(--text-muted);
  margin-bottom: 1.5rem;
  letter-spacing: 0.04em;
}

.album-credits {
  margin-top: 2rem;
  margin-bottom: 2rem;
}

.album-credits h2 {
  font-size: 0.9rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 0.75rem;
  color: var(--text-muted);
}

/* ── Reviews / Press ── */
.album-reviews { margin-top: 2rem; margin-bottom: 2rem; }
.album-reviews h2 {
  font-size: 0.9rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 0.75rem;
  color: var(--text-muted);
}
.album-reviews blockquote {
  border-left: 3px solid var(--brand-mid);
  padding: 0.75rem 1.25rem;
  margin: 1rem 0;
  font-style: italic;
  color: var(--text);
  background: rgba(0,0,0,0.02);
  border-radius: 0 4px 4px 0;
}
.album-reviews blockquote p { margin-bottom: 0.5rem; }
.album-reviews blockquote p:last-child { margin-bottom: 0; }

.credits-text {
  font-family: inherit;
  font-size: 0.85rem;
  color: var(--text-muted);
  white-space: pre-wrap;
  line-height: 1.6;
  margin: 0;
}

.tracklist-section { margin-bottom: 2rem; }
.tracklist-section h2 {
  font-size: 0.9rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 1rem;
  color: var(--text-muted);
}

.tracklist { list-style: none; padding: 0; }
.tracklist li {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 0.6rem 0;
  border-bottom: 1px solid var(--border);
  font-size: 0.9rem;
}
.tracklist li:last-child { border-bottom: none; }
.track-duration { color: var(--text-muted); font-size: 0.8rem; flex-shrink: 0; margin-left: 1rem; }

/* ── Tags ── */
.tags { list-style: none; display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.75rem; }
.tag {
  font-size: 0.7rem;
  padding: 0.2rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: 2px;
  color: var(--text-muted);
  text-transform: lowercase;
}

/* ── Prose ── */
.prose { max-width: 100%; color: var(--text); text-align: justify; }
.prose p { margin-bottom: 1rem; }
.prose h2, .prose h3 { margin: 1.5rem 0 0.75rem; font-weight: 700; }
.prose ul, .prose ol { padding-left: 1.5rem; margin-bottom: 1rem; }
.prose a { border-bottom: 1px solid var(--border); }

/* ── Text page (imprint / contact) ── */
.text-page { max-width: var(--max-width); margin: 0 auto; padding: 3rem 2rem; }
.text-page h1 { font-size: 2rem; font-weight: 800; margin-bottom: 2rem; }

/* ── Releases page ── */
.releases-page { padding: 3rem 2rem; }
.releases-page-inner { max-width: var(--max-width); margin: 0 auto; }
.releases-page h1 {
  font-size: 1.5rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  margin-bottom: 2rem;
  padding-bottom: 0.75rem;
  border-bottom: 2px solid var(--text);
}
.release-year {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.release-formats {
  font-size: 0.7rem;
  color: var(--text-muted);
  opacity: 0.8;
}

/* ── News / About sections ── */
.news-section, .about-section { background: var(--bg); }

/* ── Footer ── */
.site-footer {
  background: var(--brand-dark);
  border-top: 1px solid var(--header-border);
  padding: 2rem;
  margin-top: 4rem;
}

.footer-inner {
  max-width: var(--max-width);
  margin: 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  font-size: 0.8rem;
  color: var(--brand-light);
  flex-wrap: wrap;
  gap: 1rem;
}

.footer-legal { display: flex; flex-direction: column; gap: 0.25rem; color: var(--brand-light); }
.footer-address { font-size: 0.75rem; opacity: 0.7; }

.footer-right { display: flex; flex-direction: column; align-items: flex-end; gap: 0.75rem; }

.footer-social { display: flex; flex-wrap: wrap; gap: 1rem; justify-content: flex-end; }
.footer-social a { color: var(--brand-light); font-size: 1.2rem; opacity: 0.8; }
.footer-social a:hover { color: #fff; opacity: 1; text-decoration: none; }

.footer-nav { display: flex; gap: 1.5rem; }
.footer-nav a { color: var(--brand-light); opacity: 0.7; font-size: 0.8rem; }
.footer-nav a:hover { color: #fff; opacity: 1; text-decoration: none; }

/* ── Responsive ── */
@media (max-width: 640px) {
  .site-nav { display: none; flex-direction: column; position: absolute; top: 56px; left: 0; right: 0; background: var(--brand-dark); border-bottom: 1px solid var(--header-border); padding: 1rem; }
  .site-nav.open { display: flex; }
  .nav-toggle { display: block; }
  .header-inner { position: relative; }
  .dropdown { position: static; box-shadow: none; border: none; padding: 0 0 0 1rem; background: transparent; }
  .has-dropdown:hover .dropdown { display: none; }
  .site-hero-banner { height: 160px; }
  .site-hero-logo { width: 160px; height: 160px; bottom: -60px; left: 5%; }
  .hero-spacer { height: 80px; }
  .artist-header, .album-header { flex-direction: column; }
  .artist-photo, .album-artwork { width: 100%; height: auto; }
  .release-grid { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); }
  .artist-grid  { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); }
}
`

/**
 * Copies all files from content/global/ (if it exists) to outputDir/,
 * writes a default style.css if none was found, copies local artist photos
 * and album artwork to their respective output directories.
 *
 * @param {object} data - MergedSiteData
 * @param {string} contentDir - path to the content directory
 * @param {string} outputDir - path to the output directory
 */
async function copyAssets (data, contentDir, outputDir) {
  await fs.mkdir(outputDir, { recursive: true })

  // 1. Copy content/global/ to outputDir/
  let hasStyleCss = false
  const globalDir = path.join(contentDir, 'global')

  try {
    const entries = await fs.readdir(globalDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const src = path.join(globalDir, entry.name)
      const dest = path.join(outputDir, entry.name)
      await fs.copyFile(src, dest)
      if (entry.name === 'style.css') {
        hasStyleCss = true
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
    // global dir doesn't exist — that's fine
  }

  // 2. Write default style.css if none was found
  if (!hasStyleCss) {
    await fs.writeFile(path.join(outputDir, 'style.css'), DEFAULT_CSS, 'utf8')
  }

  // 3. Copy brand assets (logo, banner, placeholder) from ./assets/
  const brandAssets = ['logo-round.png', 'banner.jpg', 'artwork-placeholder.svg']
  for (const file of brandAssets) {
    const src = path.join('assets', file)
    try {
      await fs.copyFile(src, path.join(outputDir, file))
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn(`[assets] Could not copy ${file}:`, err.message)
    }
  }

  // 4. Copy local artist photos and album artwork
  for (const artist of (data.artists || [])) {
    const artistOutDir = path.join(outputDir, 'artists', artist.slug)

    // Artist photo
    if (artist.photo && !artist.photo.startsWith('http')) {
      await fs.mkdir(artistOutDir, { recursive: true })
      const filename = path.basename(artist.photo)
      await fs.copyFile(artist.photo, path.join(artistOutDir, filename))
    }

    // Gallery images
    if (artist.galleryImages && artist.galleryImages.length > 0) {
      const galleryOutDir = path.join(artistOutDir, 'images')
      await fs.mkdir(galleryOutDir, { recursive: true })
      for (const imgPath of artist.galleryImages) {
        if (!imgPath.startsWith('http')) {
          const filename = path.basename(imgPath)
          try {
            await fs.copyFile(imgPath, path.join(galleryOutDir, filename))
          } catch (err) {
            if (err.code !== 'ENOENT') console.warn(`[assets] Could not copy gallery image ${filename}:`, err.message)
          }
        }
      }
    }

    // Album artwork
    for (const album of (artist.albums || [])) {
      if (album.artwork && !album.artwork.startsWith('http')) {
        const albumOutDir = path.join(artistOutDir, album.slug)
        await fs.mkdir(albumOutDir, { recursive: true })
        const filename = path.basename(album.artwork)
        // Try content/{artist-slug}/{album-slug}/{filename} first,
        // then strip numeric dedup suffix (e.g. center-of-your-world-2 → center-of-your-world),
        // then artwork as-is
        const baseSlug = album.slug.replace(/-\d+$/, '')
        const candidates = [
          path.join(contentDir, artist.slug, album.slug, filename),
          path.join(contentDir, artist.slug, baseSlug, filename),
          album.artwork
        ]
        let src = null
        for (const candidate of candidates) {
          try { await fs.access(candidate); src = candidate; break } catch { /* try next */ }
        }
        if (src) {
          await fs.copyFile(src, path.join(albumOutDir, filename))
        } else {
          console.warn(`[assets] Artwork not found for "${album.title}": ${filename}`)
        }
      }
    }
  }
}

module.exports = { copyAssets }
