/* holograph.js — Origins: The Holographic Fragment */

(function () {
  'use strict';

  /* ═══════════════════════════════════════
     DARK MODE TOGGLE
     ═══════════════════════════════════════ */

  const toggle = document.querySelector('[data-theme-toggle]');
  const root = document.documentElement;
  let theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  root.setAttribute('data-theme', theme);

  function updateToggleLabel() {
    if (toggle) {
      toggle.setAttribute('aria-label', 'Switch to ' + (theme === 'dark' ? 'light' : 'dark') + ' mode');
    }
  }
  updateToggleLabel();

  if (toggle) {
    toggle.addEventListener('click', function () {
      theme = theme === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', theme);
      updateToggleLabel();
    });
  }

  /* ═══════════════════════════════════════
     READING PROGRESS BAR
     ═══════════════════════════════════════ */

  const progressBar = document.getElementById('progressBar');

  function updateProgress() {
    const scrollTop = window.scrollY;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    const progress = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
    if (progressBar) {
      progressBar.style.width = progress + '%';
    }
  }

  /* ═══════════════════════════════════════
     SCROLL-REVEAL OBSERVER
     Animates elements as they enter the viewport.
     Uses IntersectionObserver for performance.
     ═══════════════════════════════════════ */

  // Selectors for all elements that should animate in on scroll
  const revealSelectors = [
    '.resonance',
    '.cascade-step',
    '.cascade-conclusion',
    '.epistemology-card',
    '.drawing-thread',
  ];

  const observerOptions = {
    root: null,
    rootMargin: '0px 0px -60px 0px',
    threshold: 0.15,
  };

  const observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        // Once visible, stop observing
        observer.unobserve(entry.target);
      }
    });
  }, observerOptions);

  // Observe all elements matching our selectors
  revealSelectors.forEach(function (selector) {
    document.querySelectorAll(selector).forEach(function (el) {
      observer.observe(el);
    });
  });

  /* ═══════════════════════════════════════
     SCROLL HANDLER
     Throttled to ~60fps for progress bar
     ═══════════════════════════════════════ */

  let ticking = false;

  window.addEventListener('scroll', function () {
    if (!ticking) {
      requestAnimationFrame(function () {
        updateProgress();
        ticking = false;
      });
      ticking = true;
    }
  }, { passive: true });

  // Initial state
  updateProgress();

})();
