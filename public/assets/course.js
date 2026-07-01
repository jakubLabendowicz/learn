/* Generic course engine + router.
 * Routes (all served by /courses/course.html via the worker):
 *   /courses/{course}
 *   /courses/{course}/modules
 *   /courses/{course}/modules/{module}
 *   /courses/{course}/modules/{module}/articles
 *   /courses/{course}/modules/{module}/articles/{article}
 *   /courses/{course}/modules/{module}/quizes
 *   /courses/{course}/modules/{module}/quizes/{quiz}
 */
(function () {
  const app = document.getElementById('course-app');
  const topbar = document.getElementById('course-topbar');
  const footer = document.getElementById('course-footer');

  const courseSlug = decodeURIComponent(location.pathname.replace(/^\/courses\//, '').split('/')[0]);

  let COURSE = null;
  let MODULES = null;
  let SETUP = null;
  let QUIZ_SESSION = null; // { itemId, phase: 'run'|'results', ...quiz state }
  let FINAL_QUIZ_ACTIVE = false;

  fetch(`/courses/${courseSlug}.json`)
    .then(r => { if (!r.ok) throw new Error('not found'); return r.json(); })
    .then(data => { boot(data); })
    .catch(() => {
      app.innerHTML = `<div class="course-hero"><h1>Nie znaleziono kursu</h1><p><a href="/courses">Wróć do listy kursów</a></p></div>`;
    });

  function boot(data) {
    COURSE = data.course;
    MODULES = data.modules;
    document.title = `${COURSE.title} — learn`;
    document.documentElement.style.setProperty('--course-accent', COURSE.accent || '#4f46e5');
    document.getElementById('course-topbar-title').textContent = COURSE.shortTitle || COURSE.title;
    document.getElementById('course-archive-link').href = `/archive/${COURSE.slug}`;
    topbar.style.display = 'block';
    footer.style.display = 'block';

    let totalArticles = 0, totalQuizzes = 0;
    MODULES.forEach(m => m.items.forEach(it => { if (it.type === 'article') totalArticles++; else totalQuizzes++; }));
    totalQuizzes += 1; // final quiz

    const state = learnLoadState();
    learnTouchCourse(state, {
      id: COURSE.id, slug: COURSE.slug, title: COURSE.title, icon: COURSE.icon,
      accent: COURSE.accent, totalArticles, totalQuizzes,
    });
    learnSaveState(state);

    window.addEventListener('popstate', () => renderRoute());
    renderRoute();
  }

  function stateEntry() { return learnLoadState().courses[COURSE.id]; }

  function updateTopbar() {
    const pct = learnCourseProgress(stateEntry());
    document.getElementById('course-topbar-pct').textContent = pct + '% ukończone';
    document.getElementById('course-topbar-bar-fill').style.width = pct + '%';
  }

  function moduleBySlug(slug) { return MODULES.find(m => m.slug === slug); }
  function articlesOf(mod) { return mod.items.filter(i => i.type === 'article'); }
  function quizzesOf(mod) { return mod.items.filter(i => i.type === 'quiz'); }
  function articleBySlug(mod, slug) { return articlesOf(mod).find(i => i.slug === slug); }
  function quizBySlug(mod, slug) { return quizzesOf(mod).find(i => i.slug === slug); }

  // ---------------- URLs ----------------

  const courseUrl = () => `/courses/${COURSE.slug}`;
  const modulesUrl = () => `${courseUrl()}/modules`;
  const moduleUrl = m => `${modulesUrl()}/${m.slug}`;
  const articlesUrl = m => `${moduleUrl(m)}/articles`;
  const articleUrl = (m, it) => `${articlesUrl(m)}/${it.slug}`;
  const quizzesUrl = m => `${moduleUrl(m)}/quizes`;
  const quizUrl = (m, it) => `${quizzesUrl(m)}/${it.slug}`;

  // ---------------- Router ----------------

  function navigate(path) {
    FINAL_QUIZ_ACTIVE = false;
    history.pushState(null, '', path);
    renderRoute();
    window.scrollTo({ top: 0 });
  }
  window.navigate = navigate;

  function parsePath() {
    const path = decodeURIComponent(location.pathname).replace(/\/$/, '');
    const segs = path.replace(/^\/courses\//, '').split('/').filter(Boolean);
    // segs[0] is the course slug
    return {
      moduleSlug: segs[2],
      section: segs[3], // 'articles' | 'quizes'
      itemSlug: segs[4],
      depth: segs.length,
      isModulesList: segs.length === 2 && segs[1] === 'modules',
      isModule: segs.length === 3 && segs[1] === 'modules',
      isArticlesList: segs.length === 4 && segs[1] === 'modules' && segs[3] === 'articles',
      isArticle: segs.length === 5 && segs[1] === 'modules' && segs[3] === 'articles',
      isQuizzesList: segs.length === 4 && segs[1] === 'modules' && segs[3] === 'quizes',
      isQuiz: segs.length === 5 && segs[1] === 'modules' && segs[3] === 'quizes',
    };
  }

  function renderRoute() {
    if (FINAL_QUIZ_ACTIVE) {
      renderFinalQuizInPlace();
      updateTopbar();
      return;
    }

    const r = parsePath();
    if (r.depth === 1 || r.depth === 0) { app.innerHTML = renderCoursePage(); updateTopbar(); return; }
    if (r.isModulesList) { app.innerHTML = renderModulesList(); updateTopbar(); return; }

    const mod = r.moduleSlug ? moduleBySlug(r.moduleSlug) : null;
    if (!mod) { app.innerHTML = renderNotFound('moduł'); updateTopbar(); return; }

    if (r.isModule) { app.innerHTML = renderModulePage(mod); updateTopbar(); return; }
    if (r.isArticlesList) { app.innerHTML = renderArticlesList(mod); updateTopbar(); return; }
    if (r.isQuizzesList) { app.innerHTML = renderQuizzesList(mod); updateTopbar(); return; }

    if (r.isArticle) {
      const item = articleBySlug(mod, r.itemSlug);
      if (!item) { app.innerHTML = renderNotFound('artykuł'); updateTopbar(); return; }
      app.innerHTML = renderArticlePage(mod, item);
      updateTopbar();
      return;
    }

    if (r.isQuiz) {
      const item = quizBySlug(mod, r.itemSlug);
      if (!item) { app.innerHTML = renderNotFound('quiz'); updateTopbar(); return; }
      renderQuizRoute(mod, item);
      updateTopbar();
      return;
    }

    app.innerHTML = renderNotFound('strona');
    updateTopbar();
  }

  function renderNotFound(what) {
    return `<div class="course-hero"><h1>Nie znaleziono (${escapeHtml(what)})</h1><p><a href="${courseUrl()}">← Wróć do kursu</a></p></div>`;
  }

  function breadcrumbs(parts) {
    const items = parts.map((p, i) => {
      if (i === parts.length - 1) return `<span>${escapeHtml(p.label)}</span>`;
      return `<a href="${p.href}" onclick="navigate('${p.href}');return false;">${escapeHtml(p.label)}</a>`;
    });
    return `<div class="breadcrumbs">${items.join(' <span class="crumb-sep">/</span> ')}</div>`;
  }

  // ---------------- Progress helpers ----------------

  function moduleQuizAttempts(entry, quizId) {
    return (entry.quizAttempts || []).filter(a => a.itemId === quizId);
  }
  function bestAttempt(attempts) {
    if (!attempts.length) return null;
    return attempts.reduce((best, a) => (!best || a.pct > best.pct ? a : best), null);
  }
  function pillFor(best) {
    if (!best) return `<span class="pct-pill">— %</span>`;
    const cls = COURSE.passThreshold ? (best.pct >= COURSE.passThreshold ? 'good' : 'bad') : (best.pct >= 70 ? 'good' : '');
    return `<span class="pct-pill ${cls}">${best.pct}%</span>`;
  }

  // ---------------- Course page (modules + nested articles/quizzes) ----------------

  function renderCoursePage() {
    const entry = stateEntry();
    const hasWeights = MODULES.every(m => m.weight != null);

    let weightbar = '';
    if (hasWeights) {
      const segs = MODULES.map(m => {
        const color = m.accent || COURSE.accent || '#4f46e5';
        return `<div class="weightbar-seg" style="width:${m.weight}%;background:${color}" title="${escapeHtml(m.title)} — ${m.weight}%"></div>`;
      }).join('');
      weightbar = `<div class="weightbar">${segs}</div>`;
    }

    const rows = MODULES.map((m, idx) => {
      const arts = articlesOf(m);
      const quizzes = quizzesOf(m);
      const nested = `
        <div class="nested-items">
          ${arts.map(a => `<a class="nested-link" href="${articleUrl(m, a)}" onclick="navigate('${articleUrl(m, a)}');return false;">📖 ${escapeHtml(a.title)}</a>`).join('')}
          ${quizzes.map(q => `<a class="nested-link" href="${quizUrl(m, q)}" onclick="navigate('${quizUrl(m, q)}');return false;">✅ ${escapeHtml(q.title)}</a>`).join('')}
        </div>`;
      const bestQuiz = bestAttempt(quizzes.flatMap(q => moduleQuizAttempts(entry, q.id)));
      return `
        <div class="module-row-wrap">
          <div class="module-row" onclick="navigate('${moduleUrl(m)}');return false;">
            <div class="module-num">${m.icon || String(idx + 1).padStart(2, '0')}</div>
            <div class="module-row-body">
              <div class="module-row-title">${escapeHtml(m.title)}</div>
              <div class="module-row-meta">
                ${m.weight != null ? `<span>Waga egzaminu: ${m.weight}%</span>` : ''}
                <span>${arts.length} art. · ${quizzes.length} quiz${quizzes.length === 1 ? '' : 'ów'}</span>
              </div>
            </div>
            <div class="module-row-status">${pillFor(bestQuiz)}</div>
          </div>
          ${nested}
        </div>`;
    }).join('');

    const totalFinalQ = MODULES.reduce((s, m) => s + quizzesOf(m).reduce((s2, q) => s2 + q.questions.length, 0), 0);
    const finalBest = bestAttempt(moduleQuizAttempts(entry, 'final-quiz'));
    const finalRow = `
      <div class="module-row-wrap">
        <div class="module-row final" onclick="openFinalQuiz();return false;">
          <div class="module-num">🏁</div>
          <div class="module-row-body">
            <div class="module-row-title">${escapeHtml(COURSE.finalQuizTitle || 'Egzamin końcowy')}</div>
            <div class="module-row-meta"><span>${COURSE.finalQuizDescription || `${totalFinalQ} pytań ze wszystkich modułów`}</span></div>
          </div>
          <div class="module-row-status">${pillFor(finalBest)}</div>
        </div>
      </div>`;

    return `
      <div class="course-hero">
        <span class="course-hero-eyebrow">${escapeHtml(COURSE.shortTitle || 'Kurs')}</span>
        <h1>${escapeHtml(COURSE.title)}</h1>
        <p>${escapeHtml(COURSE.description || '')}</p>
        ${weightbar}
      </div>
      <div class="module-list-header">
        <h2>Moduły</h2>
        <a href="${modulesUrl()}" onclick="navigate('${modulesUrl()}');return false;">Wszystkie moduły →</a>
      </div>
      <div class="module-list">
        ${rows}
        ${finalRow}
      </div>`;
  }

  // ---------------- Modules list ----------------

  function renderModulesList() {
    const entry = stateEntry();
    const rows = MODULES.map((m, idx) => {
      const quizzes = quizzesOf(m);
      const bestQuiz = bestAttempt(quizzes.flatMap(q => moduleQuizAttempts(entry, q.id)));
      return `
        <div class="module-row" onclick="navigate('${moduleUrl(m)}');return false;">
          <div class="module-num">${m.icon || String(idx + 1).padStart(2, '0')}</div>
          <div class="module-row-body">
            <div class="module-row-title">${escapeHtml(m.title)}</div>
            <div class="module-row-meta">
              ${m.weight != null ? `<span>Waga egzaminu: ${m.weight}%</span>` : ''}
              <span>${articlesOf(m).length} art. · ${quizzes.length} quiz${quizzes.length === 1 ? '' : 'ów'}</span>
            </div>
          </div>
          <div class="module-row-status">${pillFor(bestQuiz)}</div>
        </div>`;
    }).join('');

    return `
      ${breadcrumbs([{ label: COURSE.shortTitle || COURSE.title, href: courseUrl() }, { label: 'Moduły' }])}
      <div class="course-hero"><h1>Moduły kursu</h1></div>
      <div class="module-list">${rows}</div>`;
  }

  // ---------------- Module page ----------------

  function renderModulePage(mod) {
    const entry = stateEntry();
    const arts = articlesOf(mod);
    const quizzes = quizzesOf(mod);

    const artRows = arts.map(a => {
      const read = entry.articlesRead[a.id];
      return `
        <a class="item-row" href="${articleUrl(mod, a)}" onclick="navigate('${articleUrl(mod, a)}');return false;">
          <span class="item-row-icon">📖</span>
          <span class="item-row-body">
            <span class="item-row-title">${escapeHtml(a.title)}</span>
            <span class="item-row-meta">${read ? 'Przeczytane' : 'Nieprzeczytane'}</span>
          </span>
        </a>`;
    }).join('') || `<p class="dash-empty">Brak artykułów w tym module.</p>`;

    const quizRows = quizzes.map(q => {
      const best = bestAttempt(moduleQuizAttempts(entry, q.id));
      return `
        <a class="item-row" href="${quizUrl(mod, q)}" onclick="navigate('${quizUrl(mod, q)}');return false;">
          <span class="item-row-icon">✅</span>
          <span class="item-row-body">
            <span class="item-row-title">${escapeHtml(q.title)}</span>
            <span class="item-row-meta">${q.questions.length} pytań</span>
          </span>
          ${pillFor(best)}
        </a>`;
    }).join('') || `<p class="dash-empty">Brak quizów w tym module.</p>`;

    const idx = MODULES.indexOf(mod);

    return `
      ${breadcrumbs([{ label: COURSE.shortTitle || COURSE.title, href: courseUrl() }, { label: 'Moduły', href: modulesUrl() }, { label: mod.title }])}
      <div class="module-head">
        <div class="module-head-eyebrow">Moduł ${idx + 1} / ${MODULES.length}${mod.weight != null ? ` · Waga: ${mod.weight}%` : ''}</div>
        <h1>${escapeHtml(mod.title)}</h1>
      </div>
      <div class="module-section">
        <div class="module-list-header"><h2>Artykuły</h2><a href="${articlesUrl(mod)}" onclick="navigate('${articlesUrl(mod)}');return false;">Wszystkie artykuły →</a></div>
        <div class="item-list">${artRows}</div>
      </div>
      <div class="module-section">
        <div class="module-list-header"><h2>Quizy</h2><a href="${quizzesUrl(mod)}" onclick="navigate('${quizzesUrl(mod)}');return false;">Wszystkie quizy →</a></div>
        <div class="item-list">${quizRows}</div>
      </div>`;
  }

  // ---------------- Articles / quizzes list pages ----------------

  function renderArticlesList(mod) {
    const entry = stateEntry();
    const arts = articlesOf(mod);
    const rows = arts.map(a => {
      const read = entry.articlesRead[a.id];
      return `
        <a class="item-row" href="${articleUrl(mod, a)}" onclick="navigate('${articleUrl(mod, a)}');return false;">
          <span class="item-row-icon">📖</span>
          <span class="item-row-body">
            <span class="item-row-title">${escapeHtml(a.title)}</span>
            <span class="item-row-meta">${read ? 'Przeczytane' : 'Nieprzeczytane'}</span>
          </span>
        </a>`;
    }).join('') || `<p class="dash-empty">Brak artykułów w tym module.</p>`;

    return `
      ${breadcrumbs([{ label: COURSE.shortTitle || COURSE.title, href: courseUrl() }, { label: 'Moduły', href: modulesUrl() }, { label: mod.title, href: moduleUrl(mod) }, { label: 'Artykuły' }])}
      <div class="course-hero"><h1>Artykuły — ${escapeHtml(mod.title)}</h1></div>
      <div class="item-list">${rows}</div>`;
  }

  function renderQuizzesList(mod) {
    const entry = stateEntry();
    const quizzes = quizzesOf(mod);
    const rows = quizzes.map(q => {
      const best = bestAttempt(moduleQuizAttempts(entry, q.id));
      return `
        <a class="item-row" href="${quizUrl(mod, q)}" onclick="navigate('${quizUrl(mod, q)}');return false;">
          <span class="item-row-icon">✅</span>
          <span class="item-row-body">
            <span class="item-row-title">${escapeHtml(q.title)}</span>
            <span class="item-row-meta">${q.questions.length} pytań</span>
          </span>
          ${pillFor(best)}
        </a>`;
    }).join('') || `<p class="dash-empty">Brak quizów w tym module.</p>`;

    return `
      ${breadcrumbs([{ label: COURSE.shortTitle || COURSE.title, href: courseUrl() }, { label: 'Moduły', href: modulesUrl() }, { label: mod.title, href: moduleUrl(mod) }, { label: 'Quizy' }])}
      <div class="course-hero"><h1>Quizy — ${escapeHtml(mod.title)}</h1></div>
      <div class="item-list">${rows}</div>`;
  }

  // ---------------- Article page ----------------

  function renderArticlePage(mod, item) {
    const entry = stateEntry();
    const alreadyRead = !!entry.articlesRead[item.id];
    if (!alreadyRead) {
      learnMarkArticleRead(
        { id: COURSE.id, slug: COURSE.slug, title: COURSE.title, icon: COURSE.icon, accent: COURSE.accent, totalArticles: entry.totalArticles, totalQuizzes: entry.totalQuizzes },
        mod, item
      );
    }
    const html = renderMarkdown(item.content);
    const quizzes = quizzesOf(mod);
    const ctaUrl = quizzes.length === 1 ? quizUrl(mod, quizzes[0]) : quizzesUrl(mod);
    const ctaLabel = quizzes.length === 1 ? 'Przejdź do quizu →' : 'Zobacz quizy modułu →';

    return `
      ${breadcrumbs([{ label: COURSE.shortTitle || COURSE.title, href: courseUrl() }, { label: 'Moduły', href: modulesUrl() }, { label: mod.title, href: moduleUrl(mod) }, { label: 'Artykuły', href: articlesUrl(mod) }, { label: item.title }])}
      <div class="module-head">
        <h1>${escapeHtml(item.title)}</h1>
      </div>
      <div class="article-card">
        <div class="article-body">${html}</div>
        <div class="article-footer">
          <div class="mark-read-note">✓ Artykuł oznaczony jako przeczytany</div>
          ${quizzes.length ? `<a class="course-btn" href="${ctaUrl}" onclick="navigate('${ctaUrl}');return false;">${ctaLabel}</a>` : ''}
        </div>
      </div>`;
  }

  // ---------------- Quiz: setup / run / results (scoped route version) ----------------

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function renderQuizRoute(mod, item) {
    const crumbs = breadcrumbs([
      { label: COURSE.shortTitle || COURSE.title, href: courseUrl() },
      { label: 'Moduły', href: modulesUrl() },
      { label: mod.title, href: moduleUrl(mod) },
      { label: 'Quizy', href: quizzesUrl(mod) },
      { label: item.title },
    ]);
    const backUrl = quizzesUrl(mod);

    if (!QUIZ_SESSION || QUIZ_SESSION.itemId !== item.id) {
      if (!SETUP || SETUP.itemId !== item.id) {
        SETUP = { itemId: item.id, max: item.questions.length, selected: item.questions.length };
      }
      app.innerHTML = crumbs + renderQuizSetup(mod, item, backUrl);
      return;
    }
    if (QUIZ_SESSION.phase === 'run') { app.innerHTML = crumbs + renderQuizRun(mod, item, backUrl); return; }
    if (QUIZ_SESSION.phase === 'results') { app.innerHTML = crumbs + renderQuizResults(mod, item, backUrl); return; }
    app.innerHTML = crumbs + renderQuizSetup(mod, item, backUrl);
  }

  function renderQuizSetup(mod, item, backUrl) {
    const icon = mod ? (mod.icon || '📝') : '🏁';
    const title = item.title;
    const presets = [5, 10, 15, 20, 25].filter(n => n < SETUP.max);
    const optionsHtml = presets.map(n => `
        <div class="setup-opt ${SETUP.selected === n ? 'selected' : ''}" onclick="selectSetupCount(${n})">${n}</div>
      `).join('') + `
        <div class="setup-opt ${SETUP.selected === SETUP.max ? 'selected' : ''}" onclick="selectSetupCount(${SETUP.max})">
          ${SETUP.max}<span class="setup-opt-label">Wszystkie</span>
        </div>`;

    return `
      <button class="back-link" onclick="navigate('${backUrl}')">← Wróć</button>
      <div class="setup-card">
        <div class="setup-icon">${icon}</div>
        <div class="setup-title">${escapeHtml(title)}</div>
        <div class="setup-sub">Dostępnych pytań: ${SETUP.max}. Ile losowych pytań chcesz rozwiązać?</div>
        <div class="setup-options" id="setup-options">${optionsHtml}</div>
        <div class="setup-custom">
          <label for="setup-custom-input">Własna liczba:</label>
          <input type="number" id="setup-custom-input" min="1" max="${SETUP.max}" placeholder="np. 7" oninput="onSetupCustomInput(this.value)">
        </div>
        <button class="course-btn" onclick="confirmStartQuiz()">Rozpocznij quiz →</button>
      </div>`;
  }

  function selectSetupCount(n) {
    SETUP.selected = n;
    renderRoute();
  }
  window.selectSetupCount = selectSetupCount;

  function onSetupCustomInput(v) {
    let n = parseInt(v, 10);
    if (!isNaN(n) && n >= 1) {
      SETUP.selected = Math.min(n, SETUP.max);
      document.querySelectorAll('.setup-opt').forEach(o => o.classList.remove('selected'));
    }
  }
  window.onSetupCustomInput = onSetupCustomInput;

  function confirmStartQuiz() {
    const input = document.getElementById('setup-custom-input');
    const customVal = input ? parseInt(input.value, 10) : NaN;
    let count = (!isNaN(customVal) && customVal >= 1) ? Math.min(customVal, SETUP.max) : SETUP.selected;
    if (!count || count < 1) count = SETUP.max;
    startQuiz(count);
  }
  window.confirmStartQuiz = confirmStartQuiz;

  function questionPoolFor(mod, item) {
    if (item.id === 'final-quiz') {
      let pool = [];
      MODULES.forEach(m => quizzesOf(m).forEach(q => pool.push(...q.questions)));
      return pool;
    }
    return item.questions;
  }

  function startQuiz(count) {
    const r = parsePath();
    const mod = FINAL_QUIZ_ACTIVE ? null : moduleBySlug(r.moduleSlug);
    const item = FINAL_QUIZ_ACTIVE
      ? { id: 'final-quiz', title: COURSE.finalQuizTitle || 'Egzamin końcowy', questions: questionPoolFor(null, { id: 'final-quiz' }) }
      : quizBySlug(mod, r.itemSlug);

    const pool = questionPoolFor(mod, item);
    const shuffled = shuffle(pool).slice(0, count);
    QUIZ_SESSION = {
      itemId: item.id, moduleSlug: mod ? mod.slug : null, isFinal: !mod,
      phase: 'run',
      questions: shuffled,
      index: 0,
      score: 0,
      wrong: 0,
      answers: {},
      optionOrder: {},
      multiSelection: [],
    };
    shuffled.forEach(q => { QUIZ_SESSION.optionOrder[q.id] = shuffle(q.options.map(o => o.key)); });

    if (FINAL_QUIZ_ACTIVE) renderFinalQuizInPlace();
    else renderRoute();
    window.scrollTo({ top: 0 });
  }

  function currentQuestion() { return QUIZ_SESSION.questions[QUIZ_SESSION.index]; }

  function renderQuizRun(mod, item, backUrl) {
    const q = currentQuestion();
    const total = QUIZ_SESSION.questions.length;
    const idx = QUIZ_SESSION.index;
    const answered = QUIZ_SESSION.answers[q.id];
    const isMulti = q.answer.length > 1;
    const keys = QUIZ_SESSION.optionOrder[q.id];
    const pct = Math.round((idx / total) * 100);
    const scorePct = idx > 0 ? Math.round((QUIZ_SESSION.score / idx) * 100) : 0;

    const optsHtml = keys.map(k => {
      const opt = q.options.find(o => o.key === k);
      let cls = 'opt';
      const isSelected = answered ? answered.includes(k) : QUIZ_SESSION.multiSelection.includes(k);
      const isCorrectKey = q.answer.includes(k);
      if (answered) {
        cls += ' disabled';
        if (isCorrectKey) cls += ' correct';
        else if (isSelected && !isCorrectKey) cls += ' incorrect';
      } else if (isSelected) {
        cls += ' selected';
      }
      return `<div class="${cls}" ${answered ? '' : `onclick="selectOption('${k}')"`}>
          <span class="opt-key">${k}</span><span>${escapeHtml(opt.text)}</span>
        </div>`;
    }).join('');

    let explanationHtml = '';
    if (answered) {
      const userSet = new Set(answered);
      const correctSet = new Set(q.answer);
      const isCorrect = userSet.size === correctSet.size && [...userSet].every(k => correctSet.has(k));
      explanationHtml = `
        <div class="explanation" style="display:block">
          <h4>${isCorrect ? '✓ Poprawna odpowiedź' : '✗ Niepoprawna — prawidłowa odpowiedź: ' + q.answer.join(', ')}</h4>
          <div class="exp-body">${q.explanation}</div>
        </div>`;
    }

    const nextLabel = idx + 1 < total ? 'Następne pytanie →' : 'Zobacz wyniki →';
    const multiReady = QUIZ_SESSION.multiSelection.length === q.answer.length;
    const nextBtn = answered
      ? `<button class="course-btn" onclick="nextQuestion()">${nextLabel}</button>`
      : (isMulti ? `<button class="course-btn" id="confirm-multi-btn" onclick="confirmMulti()" ${multiReady ? '' : 'disabled'}>Zatwierdź odpowiedź (${q.answer.length})</button>` : '');

    return `
      <button class="back-link" onclick="confirmExitQuiz('${backUrl}')">← Przerwij quiz</button>
      <div class="quiz-hud">
        <span>Pytanie <b>${idx + 1} / ${total}</b></span>
        <span><span class="correct-c">Poprawne <b>${QUIZ_SESSION.score}</b></span> &nbsp; <span class="wrong-c">Błędne <b>${QUIZ_SESSION.wrong}</b></span> &nbsp; Wynik <b>${scorePct}%</b></span>
      </div>
      <div class="progress-track"><span style="width:${pct}%"></span></div>
      <div class="question-card">
        <div class="q-eyebrow">${isMulti ? `WYBIERZ ${q.answer.length} ODPOWIEDZI` : 'JEDNA ODPOWIEDŹ'}</div>
        <div class="q-text">${escapeHtml(q.question)}</div>
        <div class="options">${optsHtml}</div>
        ${explanationHtml}
        <div class="q-actions">${nextBtn}</div>
      </div>`;
  }

  function selectOption(k) {
    const q = currentQuestion();
    if (QUIZ_SESSION.answers[q.id]) return;
    const isMulti = q.answer.length > 1;
    if (!isMulti) { submitAnswer([k]); return; }
    const i = QUIZ_SESSION.multiSelection.indexOf(k);
    if (i > -1) QUIZ_SESSION.multiSelection.splice(i, 1); else QUIZ_SESSION.multiSelection.push(k);
    rerenderInPlace();
  }
  window.selectOption = selectOption;

  function confirmMulti() {
    submitAnswer(QUIZ_SESSION.multiSelection.slice());
    QUIZ_SESSION.multiSelection = [];
  }
  window.confirmMulti = confirmMulti;

  function submitAnswer(selectedKeys) {
    const q = currentQuestion();
    QUIZ_SESSION.answers[q.id] = selectedKeys;
    const userSet = new Set(selectedKeys);
    const correctSet = new Set(q.answer);
    const isCorrect = userSet.size === correctSet.size && [...userSet].every(k => correctSet.has(k));
    if (isCorrect) QUIZ_SESSION.score++; else QUIZ_SESSION.wrong++;
    rerenderInPlace();
    window.scrollTo({ top: 0 });
  }

  function nextQuestion() {
    QUIZ_SESSION.index++;
    if (QUIZ_SESSION.index >= QUIZ_SESSION.questions.length) finishQuiz();
    else { rerenderInPlace(); window.scrollTo({ top: 0 }); }
  }
  window.nextQuestion = nextQuestion;

  function confirmExitQuiz(backUrl) {
    if (confirm('Czy na pewno chcesz przerwać quiz? Postęp tego podejścia nie zostanie zapisany.')) {
      QUIZ_SESSION = null;
      if (FINAL_QUIZ_ACTIVE) { FINAL_QUIZ_ACTIVE = false; renderRoute(); }
      else navigate(backUrl);
    }
  }
  window.confirmExitQuiz = confirmExitQuiz;

  function finishQuiz() {
    const total = QUIZ_SESSION.questions.length;
    const pct = Math.round((QUIZ_SESSION.score / total) * 100);
    const mod = QUIZ_SESSION.moduleSlug ? moduleBySlug(QUIZ_SESSION.moduleSlug) : null;
    const title = QUIZ_SESSION.isFinal ? (COURSE.finalQuizTitle || 'Egzamin końcowy') : (mod ? quizzesOf(mod).find(q => q.id === QUIZ_SESSION.itemId).title : '');

    const entry = stateEntry();
    learnRecordQuizAttempt(
      { id: COURSE.id, slug: COURSE.slug, title: COURSE.title, icon: COURSE.icon, accent: COURSE.accent, totalArticles: entry.totalArticles, totalQuizzes: entry.totalQuizzes },
      mod, { id: QUIZ_SESSION.itemId, title }, { score: QUIZ_SESSION.score, total, pct }
    );

    QUIZ_SESSION.phase = 'results';
    if (FINAL_QUIZ_ACTIVE) renderFinalQuizInPlace();
    else renderRoute();
    window.scrollTo({ top: 0 });
  }

  function rerenderInPlace() {
    if (FINAL_QUIZ_ACTIVE) { renderFinalQuizInPlace(); return; }
    renderRoute();
  }

  function renderQuizResults(mod, item, backUrl) {
    const total = QUIZ_SESSION.questions.length;
    const score = QUIZ_SESSION.score;
    const wrong = QUIZ_SESSION.wrong;
    const pct = Math.round((score / total) * 100);

    let color, grade, msg;
    if (pct >= 90) { color = '#16a34a'; grade = 'Celujący 🏆'; msg = 'Wybitny wynik!'; }
    else if (pct >= 80) { color = '#22c55e'; grade = 'Bardzo dobry ⭐'; msg = 'Świetna robota!'; }
    else if (pct >= 70) { color = '#eab308'; grade = 'Dobry 👍'; msg = 'Dobry wynik, warto powtórzyć słabsze obszary.'; }
    else if (pct >= 60) { color = '#f97316'; grade = 'Dostateczny 📚'; msg = 'Podstawy są, potrzeba więcej powtórek.'; }
    else { color = '#dc2626'; grade = 'Niewystarczający ❌'; msg = 'Wróć do artykułu tego modułu i spróbuj ponownie.'; }

    let passBadge = '';
    if (COURSE.passThreshold != null) {
      const pass = pct >= COURSE.passThreshold;
      passBadge = `<div class="pass-badge ${pass ? 'pass' : 'fail'}">${pass ? `ZALICZONE — próg ${COURSE.passThreshold}%` : `PONIŻEJ PROGU ${COURSE.passThreshold}%`}</div>`;
    }

    const reviewHtml = QUIZ_SESSION.questions.map((q, i) => {
      const ans = QUIZ_SESSION.answers[q.id] || [];
      const userSet = new Set(ans);
      const correctSet = new Set(q.answer);
      const isCorrect = userSet.size === correctSet.size && [...userSet].every(k => correctSet.has(k));
      const optText = key => { const o = q.options.find(x => x.key === key); return o ? `${key}: ${o.text}` : key; };
      return `
        <div class="review-item ${isCorrect ? 'r-correct' : 'r-wrong'}">
          <div class="review-q">${i + 1}. ${escapeHtml(q.question)}</div>
          <div class="review-ans">
            ${isCorrect
              ? '✅ Poprawnie: ' + escapeHtml(q.answer.map(optText).join(', '))
              : '❌ Twoja odpowiedź: <span class="your-ans">' + escapeHtml(ans.map(optText).join(', ') || '—') + '</span><br>✅ Poprawna: <span class="correct-ans">' + escapeHtml(q.answer.map(optText).join(', ')) + '</span>'}
          </div>
          <div class="review-exp">${q.explanation}</div>
        </div>`;
    }).join('');

    return `
      <div class="result-card">
        ${passBadge}
        <div class="score-circle" style="border-color:${color};background:${color}1a;">
          <span style="color:${color}">${score}</span>
          <span class="score-label">/ ${total}</span>
        </div>
        <div class="grade" style="color:${color}">${grade}</div>
        <div class="grade-msg">${msg}</div>
        <div class="stats-grid">
          <div class="stat"><div class="stat-val correct-c">${score}</div><div class="stat-label">Poprawnych</div></div>
          <div class="stat"><div class="stat-val wrong-c">${wrong}</div><div class="stat-label">Błędnych</div></div>
          <div class="stat"><div class="stat-val">${pct}%</div><div class="stat-label">Wynik</div></div>
        </div>
        <div class="result-actions">
          <button class="course-btn" onclick="retryQuizSession()">🔄 Powtórz</button>
          <button class="btn-secondary" onclick="${FINAL_QUIZ_ACTIVE ? "exitFinalQuiz()" : `navigate('${backUrl}')`}">← Wróć</button>
        </div>
        <div class="review-section">
          <h3>📋 Przegląd odpowiedzi</h3>
          ${reviewHtml}
        </div>
      </div>`;
  }

  function retryQuizSession() {
    QUIZ_SESSION = null;
    rerenderInPlace();
    window.scrollTo({ top: 0 });
  }
  window.retryQuizSession = retryQuizSession;

  // ---------------- Final quiz (course-wide, in-page state, no dedicated URL) ----------------

  function openFinalQuiz() {
    FINAL_QUIZ_ACTIVE = true;
    if (!QUIZ_SESSION || QUIZ_SESSION.itemId !== 'final-quiz') {
      const pool = questionPoolFor(null, { id: 'final-quiz' });
      SETUP = { max: pool.length, selected: pool.length };
      QUIZ_SESSION = null;
    }
    renderFinalQuizInPlace();
    window.scrollTo({ top: 0 });
  }
  window.openFinalQuiz = openFinalQuiz;

  function exitFinalQuiz() {
    FINAL_QUIZ_ACTIVE = false;
    QUIZ_SESSION = null;
    renderRoute();
    window.scrollTo({ top: 0 });
  }
  window.exitFinalQuiz = exitFinalQuiz;

  function renderFinalQuizInPlace() {
    const crumbs = breadcrumbs([{ label: COURSE.shortTitle || COURSE.title, href: courseUrl() }, { label: COURSE.finalQuizTitle || 'Egzamin końcowy' }]);
    const item = { id: 'final-quiz', title: COURSE.finalQuizTitle || 'Egzamin końcowy' };
    if (!QUIZ_SESSION) {
      app.innerHTML = crumbs + renderQuizSetup(null, item, courseUrl());
    } else if (QUIZ_SESSION.phase === 'run') {
      app.innerHTML = crumbs + renderQuizRun(null, item, courseUrl());
    } else {
      app.innerHTML = crumbs + renderQuizResults(null, item, courseUrl());
    }
  }

  // ---------------- Markdown (subset: #, ##, ###, >, lists incl. 1-level nesting, tables, bold/italic/code, hr) ----------------

  function inlineMd(s) {
    s = escapeHtml(s);
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
    s = s.replace(/`(.+?)`/g, '<code>$1</code>');
    return s;
  }

  function renderMarkdown(md) {
    const lines = md.split('\n');
    let html = '';
    let listStack = []; // stack of {type, indent}
    let inTable = false;
    let tableRows = [];

    function closeLists(toIndent) {
      while (listStack.length && (toIndent === undefined || listStack[listStack.length - 1].indent >= toIndent)) {
        html += `</${listStack.pop().type}>`;
      }
    }
    function flushTable() {
      if (!inTable) return;
      let t = '<table>';
      tableRows.forEach((row, idx) => {
        if (idx === 1) return;
        const cells = row.split('|').map(c => c.trim()).filter((c, i, arr) => !(i === 0 && c === '') && !(i === arr.length - 1 && c === ''));
        const tag = idx === 0 ? 'th' : 'td';
        t += '<tr>' + cells.map(c => `<${tag}>${inlineMd(c)}</${tag}>`).join('') + '</tr>';
      });
      t += '</table>';
      html += t;
      inTable = false; tableRows = [];
    }

    for (const raw of lines) {
      const trimmed = raw.trim();
      const indent = raw.length - raw.trimStart().length;

      if (trimmed.startsWith('|')) { inTable = true; tableRows.push(trimmed); continue; }
      else if (inTable) flushTable();

      if (trimmed === '') { closeLists(); continue; }
      if (trimmed === '---') { closeLists(); html += '<hr>'; continue; }
      if (trimmed.startsWith('# ')) { closeLists(); html += `<h1>${inlineMd(trimmed.slice(2))}</h1>`; continue; }
      if (trimmed.startsWith('## ')) { closeLists(); html += `<h2>${inlineMd(trimmed.slice(3))}</h2>`; continue; }
      if (trimmed.startsWith('### ')) { closeLists(); html += `<h3>${inlineMd(trimmed.slice(4))}</h3>`; continue; }
      if (trimmed.startsWith('> ')) { closeLists(); html += `<blockquote>${inlineMd(trimmed.slice(2))}</blockquote>`; continue; }

      const ulMatch = trimmed.match(/^[-*]\s+(.*)/);
      const olMatch = trimmed.match(/^\d+\.\s+(.*)/);
      if (ulMatch || olMatch) {
        const type = ulMatch ? 'ul' : 'ol';
        const text = ulMatch ? ulMatch[1] : olMatch[1];
        closeLists(indent + 1);
        const top = listStack[listStack.length - 1];
        if (!top || top.indent < indent) {
          html += `<${type}>`;
          listStack.push({ type, indent });
        } else if (top.type !== type) {
          html += `</${top.type}><${type}>`;
          listStack.pop();
          listStack.push({ type, indent });
        }
        html += `<li>${inlineMd(text)}</li>`;
        continue;
      }

      closeLists();
      html += `<p>${inlineMd(trimmed)}</p>`;
    }
    closeLists();
    flushTable();
    return html;
  }

  function escapeHtml(s) {
    if (s === undefined || s === null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
})();
