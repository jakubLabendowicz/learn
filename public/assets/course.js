/* Generic course engine + router.
 * Routes (all served by /courses/course.html via the worker):
 *   /courses/{course}
 *   /courses/{course}/modules
 *   /courses/{course}/modules/{module}
 *   /courses/{course}/modules/{module}/articles/{article}
 *   /courses/{course}/modules/{module}/quizes/{quiz}              (ordinary quiz or multi-set "exam" quiz)
 */
(function () {
  const app = document.getElementById('course-app');
  const topbar = document.getElementById('course-topbar');
  const footer = document.getElementById('course-footer');

  const courseSlug = decodeURIComponent(location.pathname.replace(/^\/courses\//, '').split('/')[0]);

  let COURSE = null;
  let MODULES = null;
  let SETUP = null;
  let QUIZ_SESSION = null; // { quizId, phase: 'run'|'results', ...quiz state }
  let CURRENT_USER = null;
  let lastTouchedModuleId = null;
  let lastTouchedArticleId = null;
  let lastTouchedQuizId = null;

  // The local DB (localStorage) is the only source of course data; on
  // first ever load it's seeded from the built-in course.json files.
  learnEnsureSeeded().then(() => {
    CURRENT_USER = userRepository.current();
    const data = courseRepository.getCourseData(courseSlug);
    if (!data) {
      app.innerHTML = `<div class="course-hero"><h1>Nie znaleziono kursu</h1><p><a href="/courses">Wróć do listy kursów</a></p></div>`;
      return;
    }
    boot(data);
  });

  function boot(data) {
    COURSE = data.course;
    MODULES = data.modules;
    document.title = `${COURSE.title} — learn`;
    document.getElementById('course-topbar-title').textContent = COURSE.shortTitle || COURSE.title;
    fetch(`/archive/${COURSE.slug}`, { method: 'HEAD' })
      .then(r => {
        if (r.ok) document.getElementById('course-archive-link').href = `/archive/${COURSE.slug}`;
        else document.getElementById('course-archive-wrap').style.display = 'none';
      })
      .catch(() => { document.getElementById('course-archive-wrap').style.display = 'none'; });
    document.getElementById('course-topbar-export').addEventListener('click', () => downloadCourseExport(COURSE.slug));
    topbar.style.display = 'block';
    footer.style.display = 'block';

    const userCourse = userCourseActivityRepository.touch(CURRENT_USER.id, COURSE.id);
    document.documentElement.style.setProperty('--course-accent', userCourse.customAccent || COURSE.accent || '#4f46e5');

    window.addEventListener('popstate', () => renderRoute());
    renderRoute();
  }

  function updateTopbar() {
    const pct = courseRepository.getProgress(CURRENT_USER.id, COURSE.id);
    document.getElementById('course-topbar-pct').textContent = pct + '% ukończone';
    document.getElementById('course-topbar-bar-fill').style.width = pct + '%';
  }

  function downloadCourseExport(slug) {
    const data = courseRepository.buildExportData(slug);
    if (!data) { alert('Nie udało się znaleźć kursu do eksportu.'); return; }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function moduleBySlug(slug) { return MODULES.find(m => m.slug === slug); }
  function articleBySlug(mod, slug) { return mod.articles.find(a => a.slug === slug); }
  function quizBySlug(mod, slug) { return mod.quizzes.find(q => q.slug === slug); }

  // Every module's items in reading order: its articles, then its quizzes.
  function flatItems() {
    return MODULES.flatMap(m => [
      ...m.articles.map(a => ({ module: m, kind: 'article', item: a })),
      ...m.quizzes.map(q => ({ module: m, kind: 'quiz', item: q })),
    ]);
  }

  // Previous/next item across the WHOLE course (not just within the module).
  function prevNextItem(kind, item) {
    const flat = flatItems();
    const idx = flat.findIndex(x => x.kind === kind && x.item.id === item.id);
    if (idx === -1) return { prev: null, next: null };
    return { prev: idx > 0 ? flat[idx - 1] : null, next: idx < flat.length - 1 ? flat[idx + 1] : null };
  }

  function urlFor(entry) { return entry.kind === 'article' ? articleUrl(entry.module, entry.item) : quizUrl(entry.module, entry.item); }

  // Renders the prev/next navigation for an item page.
  function itemPrevNextNav(mod, kind, item) {
    const { prev, next } = prevNextItem(kind, item);
    const prevHtml = prev
      ? `<a class="btn-secondary" href="${urlFor(prev)}" onclick="navigate('${urlFor(prev)}');return false;">← Wróć do ${escapeHtml(prev.item.shortTitle || prev.item.title)}</a>`
      : '<span></span>';
    const nextHtml = next
      ? `<a class="course-btn" href="${urlFor(next)}" onclick="navigate('${urlFor(next)}');return false;">Przejdź do ${escapeHtml(next.item.shortTitle || next.item.title)} →</a>`
      : '<span></span>';
    return `<div class="item-nav">${prevHtml}${nextHtml}</div>`;
  }

  // A quiz referencing more than one question set behaves like the former
  // "exam" type (mixed pool, weighted sampling) — flagged visually only.
  function iconForItem(kind, it) {
    if (kind === 'article') return '📖';
    return it.questionSets.length > 1 ? '🏁' : '✅';
  }

  // ---------------- URLs ----------------

  const courseUrl = () => `/courses/${COURSE.slug}`;
  const modulesUrl = () => `${courseUrl()}/modules`;
  const moduleUrl = m => `${modulesUrl()}/${m.slug}`;
  const articleUrl = (m, a) => `${moduleUrl(m)}/articles/${a.slug}`;
  const quizUrl = (m, q) => `${moduleUrl(m)}/quizes/${q.slug}`;

  // ---------------- Router ----------------

  function navigate(path) {
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
      itemSlug: segs[4],
      depth: segs.length,
      isModulesList: segs.length === 2 && segs[1] === 'modules',
      isModule: segs.length === 3 && segs[1] === 'modules',
      isArticle: segs.length === 5 && segs[1] === 'modules' && segs[3] === 'articles',
      isQuiz: segs.length === 5 && segs[1] === 'modules' && segs[3] === 'quizes',
    };
  }

  function renderRoute() {
    const r = parsePath();
    if (r.depth === 1 || r.depth === 0) { app.innerHTML = renderCoursePage(); updateTopbar(); return; }
    if (r.isModulesList) { app.innerHTML = renderModulesList(); updateTopbar(); return; }

    const mod = r.moduleSlug ? moduleBySlug(r.moduleSlug) : null;
    if (!mod) { app.innerHTML = renderNotFound('moduł'); updateTopbar(); return; }
    if (lastTouchedModuleId !== mod.id) {
      userModuleActivityRepository.touch(CURRENT_USER.id, mod.id);
      lastTouchedModuleId = mod.id;
    }

    if (r.isModule) { app.innerHTML = renderModulePage(mod); updateTopbar(); return; }

    if (r.isArticle) {
      const article = articleBySlug(mod, r.itemSlug);
      if (!article) { app.innerHTML = renderNotFound('artykuł'); updateTopbar(); return; }
      if (lastTouchedArticleId !== article.id) {
        userArticleActivityRepository.touch(CURRENT_USER.id, article.id);
        lastTouchedArticleId = article.id;
      }
      app.innerHTML = renderArticlePage(mod, article);
      updateTopbar();
      return;
    }

    if (r.isQuiz) {
      const quiz = quizBySlug(mod, r.itemSlug);
      if (!quiz) { app.innerHTML = renderNotFound('quiz'); updateTopbar(); return; }
      // Touched once per navigation (not on every re-render during a quiz
      // session) so answering questions doesn't spam localStorage writes.
      if (lastTouchedQuizId !== quiz.id) {
        userQuizActivityRepository.touch(CURRENT_USER.id, quiz.id);
        lastTouchedQuizId = quiz.id;
      }
      renderQuizRoute(mod, quiz);
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

  // Right-side status shown on item rows only: ✓ (green) for read articles,
  // n% (green/red vs. passThreshold) for attempted quizzes. Nothing is
  // shown when there's no read/attempt yet.
  function itemStatus(kind, it) {
    if (kind === 'article') {
      if (!userArticleActivityRepository.hasVisited(CURRENT_USER.id, it.id)) return '';
      return `<span class="pct-pill good">✓</span>`;
    }
    const best = userQuizAttemptRepository.best(userQuizAttemptRepository.forQuiz(CURRENT_USER.id, it.id));
    if (!best) return '';
    const cls = it.passThreshold != null ? (best.pct >= it.passThreshold ? 'good' : 'bad') : '';
    return `<span class="pct-pill ${cls}">${best.pct}%</span>`;
  }

  function moduleRow(m, idx, highlightAccent) {
    const accent = highlightAccent && /^#[0-9a-fA-F]{6}$/.test(m.accent || '') ? m.accent : null;
    const rowStyle = accent ? ` style="border-left-color:${accent};"` : '';
    const numStyle = accent ? ` style="background:${accent}1a;color:${accent};"` : '';
    return `
      <div class="module-row${accent ? ' module-row-accent' : ''}" onclick="navigate('${moduleUrl(m)}');return false;"${rowStyle}>
        <div class="module-num"${numStyle}>${m.icon || String(idx + 1).padStart(2, '0')}</div>
        <div class="module-row-body">
          <div class="module-row-title">${escapeHtml(m.shortTitle || m.title)}</div>
          <div class="module-row-desc">${escapeHtml(m.shortDescription || '')}</div>
        </div>
      </div>`;
  }

  function moduleItemRows(mod) {
    return mod.articles.map(a => itemRow(mod, 'article', a)).join('') + mod.quizzes.map(q => itemRow(mod, 'quiz', q)).join('');
  }

  // ---------------- Course page (modules + nested items) ----------------

  function renderCoursePage() {
    const rows = MODULES.map((m, idx) => {
      const nested = `<div class="nested-items">${moduleItemRows(m)}</div>`;
      return `
        <div class="module-row-wrap">
          ${moduleRow(m, idx, true)}
          ${nested}
        </div>`;
    }).join('');

    return `
      <div class="course-hero">
        <span class="course-hero-eyebrow">${escapeHtml(COURSE.shortTitle || 'Kurs')}</span>
        <h1>${escapeHtml(COURSE.title)}</h1>
        <p>${escapeHtml(COURSE.description || '')}</p>
      </div>
      <div class="module-list-header">
        <h2>Moduły</h2>
      </div>
      <div class="module-list">
        ${rows}
      </div>`;
  }

  // ---------------- Modules list ----------------

  function renderModulesList() {
    const rows = MODULES.map((m, idx) => moduleRow(m, idx)).join('');

    return `
      ${breadcrumbs([{ label: COURSE.shortTitle || COURSE.title, href: courseUrl() }, { label: 'Moduły' }])}
      <div class="course-hero"><h1>Moduły kursu</h1></div>
      <div class="module-list">${rows}</div>`;
  }

  // ---------------- Module page ----------------

  function itemRow(mod, kind, it) {
    const url = kind === 'article' ? articleUrl(mod, it) : quizUrl(mod, it);
    return `
      <a class="item-row" href="${url}" onclick="navigate('${url}');return false;">
        <span class="item-row-icon">${iconForItem(kind, it)}</span>
        <span class="item-row-body">
          <span class="item-row-title">${escapeHtml(it.shortTitle || it.title)}</span>
          <span class="item-row-desc">${escapeHtml(it.shortDescription || '')}</span>
        </span>
        ${itemStatus(kind, it)}
      </a>`;
  }

  function renderModulePage(mod) {
    const rows = moduleItemRows(mod) || `<p class="dash-empty">Brak elementów w tym module.</p>`;
    const idx = MODULES.indexOf(mod);

    return `
      ${breadcrumbs([{ label: COURSE.shortTitle || COURSE.title, href: courseUrl() }, { label: 'Moduły', href: modulesUrl() }, { label: mod.shortTitle || mod.title }])}
      <button class="back-link" onclick="navigate('${courseUrl()}')">← Wróć</button>
      <div class="module-head">
        <div class="module-head-eyebrow">Moduł ${idx + 1} / ${MODULES.length}</div>
        <h1>${escapeHtml(mod.title)}</h1>
        ${mod.description ? `<p class="module-head-desc">${escapeHtml(mod.description)}</p>` : ''}
      </div>
      <div class="item-list">${rows}</div>`;
  }

  // ---------------- Article page ----------------

  function renderArticlePage(mod, article) {
    // The visit (== "read") is recorded centrally in renderRoute().
    const html = renderMarkdown(article.content);

    return `
      ${breadcrumbs([{ label: COURSE.shortTitle || COURSE.title, href: courseUrl() }, { label: 'Moduły', href: modulesUrl() }, { label: mod.shortTitle || mod.title, href: moduleUrl(mod) }, { label: article.shortTitle || article.title }])}
      <button class="back-link" onclick="navigate('${moduleUrl(mod)}')">← Wróć</button>
      <div class="module-head">
        <h1>${escapeHtml(article.title)}</h1>
        ${article.description ? `<p class="module-head-desc">${escapeHtml(article.description)}</p>` : ''}
      </div>
      <div class="article-card">
        <div class="article-body">${html}</div>
        <div class="article-footer">
          <div class="mark-read-note">✓ Artykuł oznaczony jako przeczytany</div>
        </div>
      </div>
      ${itemPrevNextNav(mod, 'article', article)}`;
  }

  // ---------------- Quiz: setup / run / results ----------------

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function quizMaxQuestions(quiz) {
    return quiz.questionSets.reduce((sum, qs) => sum + qs.questions.length, 0);
  }

  // Builds the question set for a quiz: proportional to each referenced
  // question set's weight when fewer than all questions are requested;
  // includes everything when the full pool is requested. Quizzes with a
  // single question set (the common case) simply return `count` of their
  // own questions; quizzes with several sets (the former "exam" concept)
  // sample proportionally across all of them.
  function buildQuizSelection(quiz, count) {
    const total = quizMaxQuestions(quiz);
    if (count >= total) {
      return shuffle(quiz.questionSets.flatMap(qs => qs.questions));
    }
    const totalWeight = quiz.questionSets.reduce((s, qs) => s + qs.weight, 0) || 1;
    let selected = [];
    quiz.questionSets.forEach(qs => {
      const share = Math.round(count * (qs.weight / totalWeight));
      selected.push(...shuffle(qs.questions).slice(0, Math.min(share, qs.questions.length)));
    });
    return shuffle(selected);
  }

  const optionLabel = (q, optionId) => questionRepository.optionLabel(q, optionId);
  const correctOptionIds = q => questionRepository.correctOptionIds(q);

  function renderQuizRoute(mod, quiz) {
    const crumbs = breadcrumbs([
      { label: COURSE.shortTitle || COURSE.title, href: courseUrl() },
      { label: 'Moduły', href: modulesUrl() },
      { label: mod.shortTitle || mod.title, href: moduleUrl(mod) },
      { label: quiz.shortTitle || quiz.title },
    ]);
    const backUrl = moduleUrl(mod);

    if (!QUIZ_SESSION || QUIZ_SESSION.quizId !== quiz.id) {
      if (!SETUP || SETUP.quizId !== quiz.id) {
        const max = quizMaxQuestions(quiz);
        SETUP = { quizId: quiz.id, max, selected: max };
      }
      app.innerHTML = crumbs + renderQuizSetup(mod, quiz, backUrl);
      return;
    }
    if (QUIZ_SESSION.phase === 'run') { app.innerHTML = crumbs + renderQuizRun(mod, quiz, backUrl); return; }
    if (QUIZ_SESSION.phase === 'results') { app.innerHTML = crumbs + renderQuizResults(mod, quiz, backUrl); return; }
    app.innerHTML = crumbs + renderQuizSetup(mod, quiz, backUrl);
  }

  function renderQuizSetup(mod, quiz, backUrl) {
    const icon = quiz.questionSets.length > 1 ? '🏁' : (mod.icon || '📝');
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
        <div class="setup-title">${escapeHtml(quiz.title)}</div>
        ${quiz.description ? `<div class="setup-desc">${escapeHtml(quiz.description)}</div>` : ''}
        <div class="setup-sub">Dostępnych pytań: ${SETUP.max}. Ile losowych pytań chcesz rozwiązać?</div>
        <div class="setup-options" id="setup-options">${optionsHtml}</div>
        <div class="setup-custom">
          <label for="setup-custom-input">Własna liczba:</label>
          <input type="number" id="setup-custom-input" min="1" max="${SETUP.max}" placeholder="np. 7" oninput="onSetupCustomInput(this.value)">
        </div>
        <button class="course-btn" onclick="confirmStartQuiz()">Rozpocznij quiz →</button>
      </div>
      ${itemPrevNextNav(mod, 'quiz', quiz)}`;
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

  function startQuiz(count) {
    const r = parsePath();
    const mod = moduleBySlug(r.moduleSlug);
    const quiz = quizBySlug(mod, r.itemSlug);
    const shuffled = buildQuizSelection(quiz, count);

    QUIZ_SESSION = {
      quizId: quiz.id, moduleSlug: mod.slug,
      phase: 'run',
      questions: shuffled,
      index: 0,
      score: 0,
      wrong: 0,
      answers: {},
      optionOrder: {},
      multiSelection: [],
    };
    shuffled.forEach(q => { QUIZ_SESSION.optionOrder[q.id] = shuffle(q.options.map(o => o.id)); });

    renderRoute();
    window.scrollTo({ top: 0 });
  }

  function currentQuestion() { return QUIZ_SESSION.questions[QUIZ_SESSION.index]; }

  function renderQuizRun(mod, quiz, backUrl) {
    const q = currentQuestion();
    const total = QUIZ_SESSION.questions.length;
    const idx = QUIZ_SESSION.index;
    const answered = QUIZ_SESSION.answers[q.id];
    const correctIds = correctOptionIds(q);
    const isMulti = correctIds.length > 1;
    const order = QUIZ_SESSION.optionOrder[q.id];
    const pct = Math.round((idx / total) * 100);
    const scorePct = idx > 0 ? Math.round((QUIZ_SESSION.score / idx) * 100) : 0;

    const optsHtml = order.map(optId => {
      const opt = q.options.find(o => o.id === optId);
      const label = optionLabel(q, optId);
      let cls = 'opt';
      const isSelected = answered ? answered.includes(optId) : QUIZ_SESSION.multiSelection.includes(optId);
      if (answered) {
        cls += ' disabled';
        if (opt.correct) cls += ' correct';
        else if (isSelected && !opt.correct) cls += ' incorrect';
      } else if (isSelected) {
        cls += ' selected';
      }
      return `<div class="${cls}" ${answered ? '' : `onclick="selectOption('${optId}')"`}>
          <span class="opt-key">${label}</span><span>${escapeHtml(opt.text)}</span>
        </div>`;
    }).join('');

    let explanationHtml = '';
    if (answered) {
      const userSet = new Set(answered);
      const correctSet = new Set(correctIds);
      const isCorrect = userSet.size === correctSet.size && [...userSet].every(id => correctSet.has(id));
      const correctLabels = correctIds.map(id => optionLabel(q, id)).join(', ');
      explanationHtml = `
        <div class="explanation" style="display:block">
          <h4>${isCorrect ? '✓ Poprawna odpowiedź' : '✗ Niepoprawna — prawidłowa odpowiedź: ' + correctLabels}</h4>
          <div class="exp-body">${renderMarkdown(q.explanation)}</div>
        </div>`;
    }

    const nextLabel = idx + 1 < total ? 'Następne pytanie →' : 'Zobacz wyniki →';
    const multiReady = QUIZ_SESSION.multiSelection.length === correctIds.length;
    const nextBtn = answered
      ? `<button class="course-btn" onclick="nextQuestion()">${nextLabel}</button>`
      : (isMulti ? `<button class="course-btn" id="confirm-multi-btn" onclick="confirmMulti()" ${multiReady ? '' : 'disabled'}>Zatwierdź odpowiedź (${correctIds.length})</button>` : '');

    return `
      <button class="back-link" onclick="confirmExitQuiz('${backUrl}')">← Przerwij quiz</button>
      <div class="quiz-hud">
        <span>Pytanie <b>${idx + 1} / ${total}</b></span>
        <span><span class="correct-c">Poprawne <b>${QUIZ_SESSION.score}</b></span> &nbsp; <span class="wrong-c">Błędne <b>${QUIZ_SESSION.wrong}</b></span> &nbsp; Wynik <b>${scorePct}%</b></span>
      </div>
      <div class="progress-track"><span style="width:${pct}%"></span></div>
      <div class="question-card">
        <div class="q-eyebrow">${isMulti ? `WYBIERZ ${correctIds.length} ODPOWIEDZI` : 'JEDNA ODPOWIEDŹ'}</div>
        <div class="q-text">${escapeHtml(q.question)}</div>
        <div class="options">${optsHtml}</div>
        ${explanationHtml}
        <div class="q-actions">${nextBtn}</div>
      </div>`;
  }

  function selectOption(optId) {
    const q = currentQuestion();
    if (QUIZ_SESSION.answers[q.id]) return;
    const isMulti = correctOptionIds(q).length > 1;
    if (!isMulti) { submitAnswer([optId]); return; }
    const i = QUIZ_SESSION.multiSelection.indexOf(optId);
    if (i > -1) QUIZ_SESSION.multiSelection.splice(i, 1); else QUIZ_SESSION.multiSelection.push(optId);
    renderRoute();
  }
  window.selectOption = selectOption;

  function confirmMulti() {
    submitAnswer(QUIZ_SESSION.multiSelection.slice());
    QUIZ_SESSION.multiSelection = [];
  }
  window.confirmMulti = confirmMulti;

  function submitAnswer(selectedIds) {
    const q = currentQuestion();
    QUIZ_SESSION.answers[q.id] = selectedIds;
    const userSet = new Set(selectedIds);
    const correctSet = new Set(correctOptionIds(q));
    const isCorrect = userSet.size === correctSet.size && [...userSet].every(id => correctSet.has(id));
    if (isCorrect) QUIZ_SESSION.score++; else QUIZ_SESSION.wrong++;
    renderRoute();
    window.scrollTo({ top: 0 });
  }

  function nextQuestion() {
    QUIZ_SESSION.index++;
    if (QUIZ_SESSION.index >= QUIZ_SESSION.questions.length) finishQuiz();
    else { renderRoute(); window.scrollTo({ top: 0 }); }
  }
  window.nextQuestion = nextQuestion;

  function confirmExitQuiz(backUrl) {
    if (confirm('Czy na pewno chcesz przerwać quiz? Postęp tego podejścia nie zostanie zapisany.')) {
      QUIZ_SESSION = null;
      navigate(backUrl);
    }
  }
  window.confirmExitQuiz = confirmExitQuiz;

  function finishQuiz() {
    const total = QUIZ_SESSION.questions.length;
    const pct = Math.round((QUIZ_SESSION.score / total) * 100);

    userQuizAttemptRepository.record(CURRENT_USER.id, QUIZ_SESSION.quizId, {
      answers: QUIZ_SESSION.answers, score: QUIZ_SESSION.score, total, pct,
    });

    QUIZ_SESSION.phase = 'results';
    renderRoute();
    window.scrollTo({ top: 0 });
  }

  function renderQuizResults(mod, quiz, backUrl) {
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
    if (quiz.passThreshold != null) {
      const pass = pct >= quiz.passThreshold;
      passBadge = `<div class="pass-badge ${pass ? 'pass' : 'fail'}">${pass ? `ZALICZONE — próg ${quiz.passThreshold}%` : `PONIŻEJ PROGU ${quiz.passThreshold}%`}</div>`;
    }

    const reviewHtml = QUIZ_SESSION.questions.map((q, i) => {
      const ans = QUIZ_SESSION.answers[q.id] || [];
      const correctIds = correctOptionIds(q);
      const userSet = new Set(ans);
      const correctSet = new Set(correctIds);
      const isCorrect = userSet.size === correctSet.size && [...userSet].every(id => correctSet.has(id));
      const optText = optId => { const o = q.options.find(x => x.id === optId); return o ? `${optionLabel(q, optId)}: ${o.text}` : optId; };
      return `
        <div class="review-item ${isCorrect ? 'r-correct' : 'r-wrong'}">
          <div class="review-q">${i + 1}. ${escapeHtml(q.question)}</div>
          <div class="review-ans">
            ${isCorrect
              ? '✅ Poprawnie: ' + escapeHtml(correctIds.map(optText).join(', '))
              : '❌ Twoja odpowiedź: <span class="your-ans">' + escapeHtml(ans.map(optText).join(', ') || '—') + '</span><br>✅ Poprawna: <span class="correct-ans">' + escapeHtml(correctIds.map(optText).join(', ')) + '</span>'}
          </div>
          <div class="review-exp">${renderMarkdown(q.explanation)}</div>
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
          <button class="btn-secondary" onclick="navigate('${backUrl}')">← Wróć</button>
        </div>
        <div class="review-section">
          <h3>📋 Przegląd odpowiedzi</h3>
          ${reviewHtml}
        </div>
      </div>
      ${itemPrevNextNav(mod, 'quiz', quiz)}`;
  }

  function retryQuizSession() {
    QUIZ_SESSION = null;
    renderRoute();
    window.scrollTo({ top: 0 });
  }
  window.retryQuizSession = retryQuizSession;

  // ---------------- Markdown (subset: #, ##, ###, >, nested lists, tables, links, images, fenced code, bold/italic/code, hr) ----------------

  // Blocks dangerous URL schemes (javascript:, data:, vbscript:) in links/images.
  function safeUrl(url) {
    const trimmed = url.trim();
    return /^(javascript|data|vbscript):/i.test(trimmed) ? null : trimmed;
  }

  function inlineMd(s) {
    s = escapeHtml(s);
    s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (m, alt, url) => {
      const safe = safeUrl(url);
      return safe ? `<img src="${safe}" alt="${alt}">` : m;
    });
    s = s.replace(/\[([^\]]*)\]\(([^)]+)\)/g, (m, text, url) => {
      const safe = safeUrl(url);
      return safe ? `<a href="${safe}" target="_blank" rel="noopener noreferrer">${text}</a>` : m;
    });
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
    let inCode = false;
    let codeLines = [];

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
    function flushCode() {
      html += `<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`;
      inCode = false; codeLines = [];
    }

    for (const raw of lines) {
      const trimmed = raw.trim();
      const indent = raw.length - raw.trimStart().length;

      if (trimmed.startsWith('```')) {
        if (inCode) flushCode();
        else { closeLists(); if (inTable) flushTable(); inCode = true; codeLines = []; }
        continue;
      }
      if (inCode) { codeLines.push(raw); continue; }

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
    if (inCode) flushCode();
    return html;
  }

  function escapeHtml(s) {
    if (s === undefined || s === null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
})();
