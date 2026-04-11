/* app.js — Origins: The Suprastructure */

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
     SIDEBAR NAV — ACTIVE SECTION
     ═══════════════════════════════════════ */

  const sections = document.querySelectorAll('.chapter, #hero, #architecture');
  const navLinks = document.querySelectorAll('.nav-link');
  
  const observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        const id = entry.target.id;
        navLinks.forEach(function (link) {
          link.classList.toggle('active', link.getAttribute('data-section') === id);
        });
      }
    });
  }, {
    rootMargin: '-20% 0px -60% 0px',
    threshold: 0
  });

  sections.forEach(function (section) {
    observer.observe(section);
  });


  /* ═══════════════════════════════════════
     HAMBURGER MENU (MOBILE)
     ═══════════════════════════════════════ */

  const hamburger = document.getElementById('hamburger');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('navOverlay');

  function toggleMenu() {
    const isOpen = sidebar.classList.toggle('open');
    hamburger.classList.toggle('open', isOpen);
    overlay.classList.toggle('visible', isOpen);
    hamburger.setAttribute('aria-expanded', isOpen);
  }

  function closeMenu() {
    sidebar.classList.remove('open');
    hamburger.classList.remove('open');
    overlay.classList.remove('visible');
    hamburger.setAttribute('aria-expanded', 'false');
  }

  if (hamburger) {
    hamburger.addEventListener('click', toggleMenu);
  }

  if (overlay) {
    overlay.addEventListener('click', closeMenu);
  }

  // Close menu when clicking nav links on mobile
  navLinks.forEach(function (link) {
    link.addEventListener('click', function () {
      if (window.innerWidth <= 1024) {
        closeMenu();
      }
    });
  });

  // Also close when clicking the nav-logo on mobile
  const navLogo = document.querySelector('.nav-logo');
  if (navLogo) {
    navLogo.addEventListener('click', function () {
      if (window.innerWidth <= 1024) {
        closeMenu();
      }
    });
  }


  /* ═══════════════════════════════════════
     SCROLL ANIMATIONS — Intersection Observer
     ═══════════════════════════════════════ */

  const prefersReducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!prefersReducedMotion) {
    const animElements = document.querySelectorAll('.chapter, .pullquote, .chapter-card, .opening');
    
    const animObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          // Stagger chapter-cards
          if (entry.target.classList.contains('chapter-card')) {
            var cards = document.querySelectorAll('.chapter-card');
            var idx = Array.from(cards).indexOf(entry.target);
            entry.target.style.transitionDelay = (idx * 0.1) + 's';
          }
          entry.target.classList.add('visible');
          animObserver.unobserve(entry.target);
        }
      });
    }, {
      rootMargin: '0px 0px -60px 0px',
      threshold: 0.01
    });

    animElements.forEach(function (el) {
      animObserver.observe(el);
    });
  } else {
    // Make everything visible immediately
    document.querySelectorAll('.chapter, .pullquote, .chapter-card, .opening').forEach(function (el) {
      el.classList.add('visible');
    });
  }


  /* ═══════════════════════════════════════
     SCROLL LISTENER
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

  // Initial call
  updateProgress();

})();
