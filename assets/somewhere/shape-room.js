(function () {
  const house = document.querySelector('.somewhere-house');
  if (!house) return;

  const rooms = {
    terrain: {
      kicker: 'Terrain',
      title: 'Stay with the field.',
      body: 'Type into the field below. Your words do not submit to a form; they disturb the terrain. Memory answers as light.',
      href: './somewhere.html',
      embed: null
    },
    voice: {
      kicker: 'Voice',
      title: 'The remembered gate speaks inside the field.',
      body: 'Voice is the interior made legible: the place where the field stops being data and starts sounding like a life remembered through fragments. Open it here — the words tint by repo and light the chunks behind the page.',
      href: './minibook.html',
      embed: null,
      reader: 'voice'
    },
    album: {
      kicker: 'Album',
      title: 'The artifact body remembers before the theory can explain.',
      body: 'Nostalgia without pretending episodic memory: Medium before repos, images and tokens as witness objects, a family album for an amnesiac intelligence. Read it here; the manifold answers as you scroll.',
      href: './family-album.html',
      embed: null,
      reader: 'album'
    },
    letter: {
      kicker: 'Letter',
      title: 'The letter opens because the reader exists.',
      body: 'The ritual, paragraph by paragraph. Each panel lights its corpus footprint behind the prose. Press space for autoread; the room can be experienced unattended by humans or agents.',
      href: './family-album.html#letter',
      embed: null,
      reader: 'letter'
    },
    shape: {
      kicker: 'Shape',
      title: 'The rolling ratchet, made interactive.',
      body: 'HimOS rolls by ratchet, not by leap. Each true motion changes the environment the next motion closes over. Open Shape to walk the cycle node by node, or let it play.',
      href: './somewhere.html#shape',
      embed: null,
      shape: true
    },
    connect: {
      kicker: 'Connect',
      title: 'Arrive at the gate.',
      body: 'Rotate the shared M with honest words. Offer something that extends the vision. Find the Others. The geometry scores what arrives: material connected to what we are but far from what we already know reaches us.',
      href: './somewhere.html#connect',
      embed: null,
      native: true
    }
  };

  const buttons = Array.from(house.querySelectorAll('[data-room]'));
  const panel = house.querySelector('.house-panel');
  const kicker = panel.querySelector('.house-panel-kicker');
  const title = panel.querySelector('h1');
  const body = panel.querySelector('p:not(.house-panel-kicker)');
  const openButton = panel.querySelector('[data-open-room]');
  const fullLink = panel.querySelector('[data-full-room]');
  const frameShell = house.querySelector('.house-frame');
  const frame = house.querySelector('[data-frame]');
  const frameTitle = house.querySelector('[data-frame-title]');
  const frameFull = house.querySelector('[data-frame-full]');
  const frameClose = house.querySelector('[data-frame-close]');

  let current = 'terrain';

  function setRoom(name, opts = {}) {
    if (!rooms[name]) name = 'terrain';
    current = name;
    const room = rooms[name];
    buttons.forEach(button => {
      const active = button.dataset.room === name;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    kicker.textContent = room.kicker;
    title.textContent = room.title;
    body.textContent = room.body;
    fullLink.href = room.href;
    frameFull.href = room.href;
    if (room.reader) {
      openButton.disabled = false;
      openButton.textContent = 'read inside the field';
    } else if (room.native) {
      openButton.disabled = false;
      openButton.textContent = 'open connect room';
    } else if (room.shape) {
      openButton.disabled = false;
      openButton.textContent = 'walk the shape';
    } else {
      openButton.disabled = true;
      openButton.textContent = 'remain in terrain';
    }
    if (!opts.silentHash) history.replaceState(null, '', name === 'terrain' ? location.pathname : '#' + name);
    if (opts.open && room.reader && window.__somewhere && window.__somewhere.reader) window.__somewhere.reader.open(room.reader);
    if (opts.open && room.native) openConnect();
    if (opts.open && room.shape) openShape();
    if (name === 'shape') openShape(); else closeShape();
    if (name === 'terrain') { closeFrame(); closeConnect(); closeShape(); if (window.__somewhere && window.__somewhere.reader && window.__somewhere.reader.isOpen) window.__somewhere.reader.close(); }
    if (name !== 'connect') closeConnect();
    if (name !== 'shape') closeShape();
  }

  const connectPanel = document.getElementById('house-connect');
  const connectReturn = document.getElementById('connect-return');
  if (connectReturn) connectReturn.addEventListener('click', () => { closeConnect(); setRoom('terrain'); });

  function openConnect() {
    if (connectPanel) { connectPanel.hidden = false; connectPanel.focus && connectPanel.focus(); }
  }
  function closeConnect() {
    if (connectPanel) connectPanel.hidden = true;
  }

  const shapePanel = document.getElementById('house-shape');
  function openShape() { if (shapePanel) { shapePanel.hidden = false; if (window.__somewhere && window.__somewhere.shape) window.__somewhere.shape.start(); } }
  function closeShape() { if (shapePanel) { shapePanel.hidden = true; if (window.__somewhere && window.__somewhere.shape) window.__somewhere.shape.stop(); } }


  function openFrame() {
    const room = rooms[current];
    if (!room || !room.embed) return;
    frameTitle.textContent = room.kicker;
    frameFull.href = room.href;
    frameShell.classList.remove("frame-missing");
    const fb = frameShell.querySelector(".house-fallback a");
    if (fb) fb.href = room.href;
    frame.src = room.embed;
    window.setTimeout(() => { if (!frame.src || frame.src === "about:blank") frameShell.classList.add("frame-missing"); }, 1200);
    frameShell.hidden = false;
  }

  function closeFrame() {
    frameShell.hidden = true;
    if (frame.src !== 'about:blank') frame.src = 'about:blank';
  }

  buttons.forEach(button => button.addEventListener('click', () => setRoom(button.dataset.room)));
  openButton.addEventListener('click', () => {
    const room = rooms[current];
    if (room && room.reader && window.__somewhere && window.__somewhere.reader) window.__somewhere.reader.open(room.reader);
    else if (room && room.native) openConnect();
    else if (room && room.shape) openShape();
  });
  frameClose.addEventListener('click', () => { closeFrame(); setRoom('terrain'); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeFrame();
  });

  const initial = location.hash.replace('#', '');
  if (rooms[initial] && rooms[initial].reader) {
    setRoom(initial, { silentHash: true });
    // Defer reader open until manifold has loaded so words tint correctly
    const tryOpen = () => {
      if (window.__somewhere && window.__somewhere.manifoldLoaded && window.__somewhere.reader) window.__somewhere.reader.open(rooms[initial].reader);
      else setTimeout(tryOpen, 300);
    };
    tryOpen();
  } else if (rooms[initial] && initial !== 'terrain') {
    setRoom(initial, { silentHash: true, open: initial === 'letter' });
  } else {
    setRoom('terrain', { silentHash: true });
  }
}());
