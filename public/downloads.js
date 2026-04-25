'use strict';

function setLink(id, href, fallbackLabel) {
  const el = document.getElementById(id);
  if (!el) return;
  const safeHref = String(href || '').trim();
  if (!/^https?:\/\//i.test(safeHref)) {
    el.classList.add('is-disabled');
    el.removeAttribute('href');
    el.textContent = `${fallbackLabel} (pendente)`;
    return;
  }
  el.classList.remove('is-disabled');
  el.href = safeHref;
  el.textContent = fallbackLabel;
}

async function loadRelease() {
  const versionEl = document.getElementById('release-version');
  const metaEl = document.getElementById('release-meta');
  const changelogMetaEl = document.getElementById('release-changelog-meta');

  try {
    const res = await fetch('releases/latest.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const version = String(data?.version || '').trim().replace(/^v/i, '');
    const downloads = data && typeof data.downloads === 'object' ? data.downloads : {};

    versionEl.textContent = version ? `v${version}` : 'v–';
    const published = String(data?.publishedAt || '').trim();
    metaEl.textContent = published
      ? `v${version} · publicada em ${published}.`
      : `v${version}`;
    if (changelogMetaEl) {
      changelogMetaEl.textContent = published
        ? `Publicada em ${published}`
        : 'Release carregada.';
    }
    const notesEl = document.getElementById('release-notes');
    if (notesEl) notesEl.textContent = String(data?.notes || '');

    setLink('dl-mac-arm64', downloads['mac-arm64'], 'Baixar DMG (Silicon)');
    setLink('dl-mac-x64', downloads['mac-x64'], 'Baixar DMG (Intel)');
    setLink('dl-win-x64', downloads['win-x64'], 'Baixar Instalador');
  } catch (err) {
    versionEl.textContent = 'v–';
    metaEl.textContent = `Falha ao carregar release: ${String(err?.message || err || 'erro desconhecido')}`;
    if (changelogMetaEl) changelogMetaEl.textContent = 'Falha ao carregar changelog.';
    setLink('dl-mac-arm64', '', 'Baixar DMG (Silicon)');
    setLink('dl-mac-x64', '', 'Baixar DMG (Intel)');
    setLink('dl-win-x64', '', 'Baixar Instalador');
  }
}

loadRelease();
