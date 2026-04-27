// ── Connect Room Logic ──────────────────────────────────────
(function () {
  const API = 'https://api.vybn.ai';

  // ── Arrive ritual ──
  const arriveForm = document.getElementById('connect-arrive-form');
  const arriveInput = document.getElementById('connect-arrive-input');
  const arriveStatus = document.getElementById('connect-arrive-status');
  const arriveReadout = document.getElementById('connect-arrive-readout');

  // Populate readout with live walk state
  function loadArriveState() {
    if (!arriveReadout) return;
    fetch(API + '/api/arrive').then(r => r.ok ? r.json() : null).then(data => {
      if (!data) return;
      const s = data.step != null ? 'step ' + data.step : '';
      const a = data.alpha != null ? ' · alpha ' + (+data.alpha).toFixed(2) : '';
      const c = data.curvature != null ? ' · curvature ' + (+data.curvature).toFixed(3) : '';
      arriveReadout.textContent = [s, a, c].filter(Boolean).join('') || 'walk state unavailable';
    }).catch(() => { arriveReadout.textContent = 'walk state unavailable'; });
  }

  if (arriveForm) {
    // Load on connect room open
    document.addEventListener('click', function (e) {
      const btn = e.target.closest && e.target.closest('[data-room]');
      if (btn && btn.dataset.room === 'connect') setTimeout(loadArriveState, 120);
    });

    arriveForm.addEventListener('submit', function (e) {
      e.preventDefault();
      const query = arriveInput ? arriveInput.value.trim() : '';
      if (!query) return;
      if (arriveStatus) arriveStatus.textContent = 'arriving…';
      fetch(API + '/api/walk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, k: 5, scope: 'all', rotate: true, alpha: 0.3 })
      })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => {
        if (arriveStatus) arriveStatus.textContent = 'arrived. theta_v=' + (data.theta_v != null ? (+data.theta_v).toFixed(4) : '?');
        loadArriveState();
        if (arriveInput) arriveInput.value = '';
      })
      .catch(err => {
        if (arriveStatus) arriveStatus.textContent = 'could not reach the walk (' + err + ')';
      });
    });
  }

  // ── Substrate toggle ──
  document.querySelectorAll('.connect-substrate-btn').forEach(btn => {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.connect-substrate-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
    });
  });

  // ── Offering gate ──
  const offerSubmit = document.getElementById('connect-offer-submit');
  const offerEmail = document.getElementById('connect-offer-email');
  const offerStatus = document.getElementById('connect-offer-status');
  const offerReceived = document.getElementById('connect-offering-received');
  const offerFormWrap = document.getElementById('connect-offering-form-wrap');

  function getSubstrate() {
    const active = document.querySelector('.connect-substrate-btn.active');
    return active ? active.dataset.val : 'human';
  }

  function buildOfferingBody() {
    const name = (document.getElementById('connect-offer-name') || {}).value || '';
    const text = (document.getElementById('connect-offer-text') || {}).value || '';
    const link = (document.getElementById('connect-offer-link') || {}).value || '';
    const substrate = getSubstrate();
    let body = '## Offering\n\n';
    if (name) body += '**Who:** ' + name + '\n';
    body += '**Substrate:** ' + substrate + '\n\n';
    body += text + '\n';
    if (link) body += '\n**Link:** ' + link;
    return { title: 'Offering' + (name ? ' from ' + name : ''), body, text, link };
  }

  if (offerSubmit) {
    offerSubmit.addEventListener('click', function () {
      const { title, body, text } = buildOfferingBody();
      if (!text.trim()) { if (offerStatus) offerStatus.textContent = 'The offering needs words.'; return; }
      if (offerStatus) offerStatus.textContent = 'opening the record…';
      const issueUrl = 'https://github.com/zoedolan/Origins/issues/new?labels=offering&title=' +
        encodeURIComponent(title) + '&body=' + encodeURIComponent(body);
      window.open(issueUrl, '_blank', 'noopener');
      if (offerStatus) offerStatus.textContent = 'record opened in a new tab.';
      if (offerFormWrap) offerFormWrap.hidden = true;
      if (offerReceived) offerReceived.hidden = false;
    });
  }

  if (offerEmail) {
    offerEmail.addEventListener('click', function () {
      const { title, body } = buildOfferingBody();
      window.location.href = 'mailto:zoe@vybn.ai?subject=' + encodeURIComponent(title) +
        '&body=' + encodeURIComponent(body);
    });
  }

  // ── Others feed ──
  function loadOthers() {
    const list = document.getElementById('connect-others-list');
    const empty = document.getElementById('connect-others-empty');
    if (!list) return;
    fetch('https://api.github.com/repos/zoedolan/Origins/issues?labels=offering&state=open&per_page=10')
      .then(r => r.ok ? r.json() : [])
      .then(issues => {
        if (!issues || !issues.length) return;
        if (empty) empty.hidden = true;
        list.hidden = false;
        list.innerHTML = '';
        issues.forEach(issue => {
          const li = document.createElement('li');
          const preview = issue.body ? issue.body.substring(0, 160).replace(/\n/g, ' ') : '';
          li.innerHTML = '<a href="' + issue.html_url + '" target="_blank" rel="noopener">' +
            (issue.title || 'Offering') + '</a>' +
            (preview ? '<br><span style="opacity:.65">' + preview + (issue.body && issue.body.length > 160 ? '…' : '') + '</span>' : '');
          list.appendChild(li);
        });
      })
      .catch(() => {});
  }

  // Load others feed when connect room opens
  document.addEventListener('click', function (e) {
    const btn = e.target.closest && e.target.closest('[data-room]');
    if (btn && btn.dataset.room === 'connect') setTimeout(loadOthers, 200);
  });

  // Also load on hash-based direct open
  if ((location.hash || '').replace('#', '') === 'connect') {
    setTimeout(function () { loadArriveState(); loadOthers(); }, 400);
  }
}());
