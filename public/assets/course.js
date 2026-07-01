/* Generic course engine + router.
 * Routes (all served by /courses/course.html via the worker):
 *   /courses/{course}
 *   /courses/{course}/modules
 *   /courses/{course}/modules/{module}
 *   /courses/{course}/modules/{module}/items
 *   /courses/{course}/modules/{module}/items/{item}   (article, quiz or exam, by item.type)
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

  const imported = learnGetImportedCourse(courseSlug);
  if (imported) {
    // Defer to a microtask so this runs after the rest of the script has
    // finished executing (all the const helpers below must be initialized
    // first — the fetch() branch gets this for free since it resolves async).
    Promise.resolve().then(() => boot(imported));
  } else {
    fetch(`/courses/${courseSlug}.json`)
      .then(r => { if (!r.ok) throw new Error('not found'); return r.json(); })
      .then(data => { boot(data); })
      .catch(() => {
        app.innerHTML = `<div class="course-hero"><h1>Nie znaleziono kursu</h1><p><a href="/courses">Wróć do listy kursów</a></p></div>`;
      });
  }

  function boot(data) {
    COURSE = data.course;
    MODULES = data.modules;
    document.title = `${COURSE.title} — learn`;
    document.documentElement.style.setProperty('--course-accent', COURSE.accent || '#4f46e5');
    document.getElementById('course-topbar-title').textContent = COURSE.shortTitle || COURSE.title;
    if (imported) document.getElementById('course-archive-wrap').style.display = 'none';
    else document.getElementById('course-archive-link').href = `/archive/${COURSE.slug}`;
    document.getElementById('course-topbar-export').addEventListener('click', () => learnExportCourse(COURSE.slug));
    topbar.style.display = 'block';
    footer.style.display = 'block';

    let totalArticles = 0, totalQuizzes = 0;
    MODULES.forEach(m => m.items.forEach(it => { if (it.type === 'article') totalArticles++; else totalQuizzes++; }));

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
  function itemBySlug(mod, slug) { return mod.items.find(i => i.slug === slug); }

  function flatItems() {
    return MODULES.flatMap(m => m.items.map(it => ({ module: m, item: it })));
  }

  function itemById(id) {
    const found = flatItems().find(x => x.item.id === id);
    return found ? found.item : null;
  }

  // Previous/next item across the WHOLE course (not just within the module).
  function prevNextItem(item) {
    const flat = flatItems();
    const idx = flat.findIndex(x => x.item.id === item.id);
    if (idx === -1) return { prev: null, next: null };
    return { prev: idx > 0 ? flat[idx - 1] : null, next: idx < flat.length - 1 ? flat[idx + 1] : null };
  }

  // Renders the prev/next navigation for an item page.
  function itemPrevNextNav(mod, item) {
    const { prev, next } = prevNextItem(item);
    const prevHtml = prev
      ? `<a class="btn-secondary" href="${itemUrl(prev.module, prev.item)}" onclick="navigate('${itemUrl(prev.module, prev.item)}');return false;">← Wróć do ${escapeHtml(prev.item.shortTitle || prev.item.title)}</a>`
      : '<span></span>';
    const nextHtml = next
      ? `<a class="course-btn" href="${itemUrl(next.module, next.item)}" onclick="navigate('${itemUrl(next.module, next.item)}');return false;">Przejdź do ${escapeHtml(next.item.shortTitle || next.item.title)} →</a>`
      : '<span></span>';
    return `<div class="item-nav">${prevHtml}${nextHtml}</div>`;
  }

  function iconForType(type) {
    if (type === 'article') return '📖';
    if (type === 'exam') return '🏁';
    return '✅'; // quiz
  }

  // ---------------- URLs ----------------

  const courseUrl = () => `/courses/${COURSE.slug}`;
  const modulesUrl = () => `${courseUrl()}/modules`;
  const moduleUrl = m => `${modulesUrl()}/${m.slug}`;
  const itemsUrl = m => `${moduleUrl(m)}/items`;
  const itemUrl = (m, it) => `${itemsUrl(m)}/${it.slug}`;

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
      isItemsList: segs.length === 4 && segs[1] === 'modules' && segs[3] === 'items',
      isItem: segs.length === 5 && segs[1] === 'modules' && segs[3] === 'items',
    };
  }

  function renderRoute() {
    const r = parsePath();
    if (r.depth === 1 || r.depth === 0) { app.innerHTML = renderCoursePage(); updateTopbar(); return; }
    if (r.isModulesList) { app.innerHTML = renderModulesList(); updateTopbar(); return; }

    const mod = r.moduleSlug ? moduleBySlug(r.moduleSlug) : null;
    if (!mod) { app.innerHTML = renderNotFound('moduł'); updateTopbar(); return; }

    if (r.isModule) { app.innerHTML = renderModulePage(mod); updateTopbar(); return; }
    if (r.isItemsList) { app.innerHTML = renderItemsList(mod); updateTopbar(); return; }

    if (r.isItem) {
      const item = itemBySlug(mod, r.itemSlug);
      if (!item) { app.innerHTML = renderNotFound('element'); updateTopbar(); return; }
      if (item.type === 'article') { app.innerHTML = renderArticlePage(mod, item); updateTopbar(); return; }
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
  // Right-side status shown on item rows only: ✓ (green) for read articles,
  // n% (green/red vs. passThreshold) for attempted quizzes/exams. Nothing is
  // shown when there's no read/attempt yet.
  function itemStatus(entry, it) {
    if (it.type === 'article') {
      if (!entry.articlesRead[it.id]) return '';
      return `<span class="pct-pill good">✓</span>`;
    }
    const best = bestAttempt(moduleQuizAttempts(entry, it.id));
    if (!best) return '';
    const cls = it.passThreshold != null ? (best.pct >= it.passThreshold ? 'good' : 'bad') : '';
    return `<span class="pct-pill ${cls}">${best.pct}%</span>`;
  }

  function moduleRow(m, idx) {
    return `
      <div class="module-row" onclick="navigate('${moduleUrl(m)}');return false;">
        <div class="module-num">${m.icon || String(idx + 1).padStart(2, '0')}</div>
        <div class="module-row-body">
          <div class="module-row-title">${escapeHtml(m.shortTitle || m.title)}</div>
          <div class="module-row-desc">${escapeHtml(m.description || '')}</div>
        </div>
      </div>`;
  }

  // ---------------- Course page (modules + nested items) ----------------

  function renderCoursePage() {
    const entry = stateEntry();

    const rows = MODULES.map((m, idx) => {
      const nested = `
        <div class="nested-items">
          ${m.items.map(it => itemRow(m, entry, it)).join('')}
        </div>`;
      return `
        <div class="module-row-wrap">
          ${moduleRow(m, idx)}
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

  function itemRow(mod, entry, it) {
    return `
      <a class="item-row" href="${itemUrl(mod, it)}" onclick="navigate('${itemUrl(mod, it)}');return false;">
        <span class="item-row-icon">${iconForType(it.type)}</span>
        <span class="item-row-body">
          <span class="item-row-title">${escapeHtml(it.shortTitle || it.title)}</span>
          <span class="item-row-desc">${escapeHtml(it.description || '')}</span>
        </span>
        ${itemStatus(entry, it)}
      </a>`;
  }

  function renderModulePage(mod) {
    const entry = stateEntry();
    const rows = mod.items.map(it => itemRow(mod, entry, it)).join('') || `<p class="dash-empty">Brak elementów w tym module.</p>`;
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

  // ---------------- Items list page ----------------

  function renderItemsList(mod) {
    const entry = stateEntry();
    const rows = mod.items.map(it => itemRow(mod, entry, it)).join('') || `<p class="dash-empty">Brak elementów w tym module.</p>`;

    return `
      ${breadcrumbs([{ label: COURSE.shortTitle || COURSE.title, href: courseUrl() }, { label: 'Moduły', href: modulesUrl() }, { label: mod.shortTitle || mod.title, href: moduleUrl(mod) }, { label: 'Elementy' }])}
      <div class="course-hero"><h1>Elementy — ${escapeHtml(mod.title)}</h1></div>
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

    return `
      ${breadcrumbs([{ label: COURSE.shortTitle || COURSE.title, href: courseUrl() }, { label: 'Moduły', href: modulesUrl() }, { label: mod.shortTitle || mod.title, href: moduleUrl(mod) }, { label: 'Elementy', href: itemsUrl(mod) }, { label: item.shortTitle || item.title }])}
      <button class="back-link" onclick="navigate('${moduleUrl(mod)}')">← Wróć</button>
      <div class="module-head">
        <h1>${escapeHtml(item.title)}</h1>
        ${item.description ? `<p class="module-head-desc">${escapeHtml(item.description)}</p>` : ''}
      </div>
      <div class="article-card">
        <div class="article-body">${html}</div>
        <div class="article-footer">
          <div class="mark-read-note">✓ Artykuł oznaczony jako przeczytany</div>
        </div>
      </div>
      ${itemPrevNextNav(mod, item)}`;
  }

  // ---------------- Quiz / exam: setup / run / results ----------------

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function examMaxQuestions(examItem) {
    return examItem.quizes.reduce((sum, ref) => {
      const q = itemById(ref.id);
      return sum + (q ? q.questions.length : 0);
    }, 0);
  }

  // Builds the question set for an exam: proportional to each referenced
  // quiz's weight when fewer than all questions are requested; includes
  // everything when the full pool is requested.
  function buildExamSelection(examItem, count) {
    const total = examMaxQuestions(examItem);
    if (count >= total) {
      let all = [];
      examItem.quizes.forEach(ref => {
        const q = itemById(ref.id);
        if (q) all.push(...q.questions);
      });
      return shuffle(all);
    }
    const totalWeight = examItem.quizes.reduce((s, r) => s + r.weight, 0) || 1;
    let selected = [];
    examItem.quizes.forEach(ref => {
      const q = itemById(ref.id);
      if (!q) return;
      const share = Math.round(count * (ref.weight / totalWeight));
      selected.push(...shuffle(q.questions).slice(0, Math.min(share, q.questions.length)));
    });
    return shuffle(selected);
  }

  function renderQuizRoute(mod, item) {
    const crumbs = breadcrumbs([
      { label: COURSE.shortTitle || COURSE.title, href: courseUrl() },
      { label: 'Moduły', href: modulesUrl() },
      { label: mod.shortTitle || mod.title, href: moduleUrl(mod) },
      { label: 'Elementy', href: itemsUrl(mod) },
      { label: item.shortTitle || item.title },
    ]);
    const backUrl = moduleUrl(mod);

    if (!QUIZ_SESSION || QUIZ_SESSION.itemId !== item.id) {
      if (!SETUP || SETUP.itemId !== item.id) {
        const max = item.type === 'exam' ? examMaxQuestions(item) : item.questions.length;
        SETUP = { itemId: item.id, max, selected: max };
      }
      app.innerHTML = crumbs + renderQuizSetup(mod, item, backUrl);
      return;
    }
    if (QUIZ_SESSION.phase === 'run') { app.innerHTML = crumbs + renderQuizRun(mod, item, backUrl); return; }
    if (QUIZ_SESSION.phase === 'results') { app.innerHTML = crumbs + renderQuizResults(mod, item, backUrl); return; }
    app.innerHTML = crumbs + renderQuizSetup(mod, item, backUrl);
  }

  function renderQuizSetup(mod, item, backUrl) {
    const icon = item.type === 'exam' ? '🏁' : (mod.icon || '📝');
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
        <div class="setup-title">${escapeHtml(item.title)}</div>
        ${item.description ? `<div class="setup-desc">${escapeHtml(item.description)}</div>` : ''}
        <div class="setup-sub">Dostępnych pytań: ${SETUP.max}. Ile losowych pytań chcesz rozwiązać?</div>
        <div class="setup-options" id="setup-options">${optionsHtml}</div>
        <div class="setup-custom">
          <label for="setup-custom-input">Własna liczba:</label>
          <input type="number" id="setup-custom-input" min="1" max="${SETUP.max}" placeholder="np. 7" oninput="onSetupCustomInput(this.value)">
        </div>
        <button class="course-btn" onclick="confirmStartQuiz()">Rozpocznij quiz →</button>
      </div>
      ${itemPrevNextNav(mod, item)}`;
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
    const item = itemBySlug(mod, r.itemSlug);
    const shuffled = item.type === 'exam' ? buildExamSelection(item, count) : shuffle(item.questions).slice(0, count);

    QUIZ_SESSION = {
      itemId: item.id, moduleSlug: mod.slug,
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

    renderRoute();
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
    renderRoute();
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
    const mod = moduleBySlug(QUIZ_SESSION.moduleSlug);
    const item = itemById(QUIZ_SESSION.itemId);

    const entry = stateEntry();
    learnRecordQuizAttempt(
      { id: COURSE.id, slug: COURSE.slug, title: COURSE.title, icon: COURSE.icon, accent: COURSE.accent, totalArticles: entry.totalArticles, totalQuizzes: entry.totalQuizzes },
      mod, item, { score: QUIZ_SESSION.score, total, pct }
    );

    QUIZ_SESSION.phase = 'results';
    renderRoute();
    window.scrollTo({ top: 0 });
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
    if (item.passThreshold != null) {
      const pass = pct >= item.passThreshold;
      passBadge = `<div class="pass-badge ${pass ? 'pass' : 'fail'}">${pass ? `ZALICZONE — próg ${item.passThreshold}%` : `PONIŻEJ PROGU ${item.passThreshold}%`}</div>`;
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
          <button class="btn-secondary" onclick="navigate('${backUrl}')">← Wróć</button>
        </div>
        <div class="review-section">
          <h3>📋 Przegląd odpowiedzi</h3>
          ${reviewHtml}
        </div>
      </div>
      ${itemPrevNextNav(mod, item)}`;
  }

  function retryQuizSession() {
    QUIZ_SESSION = null;
    renderRoute();
    window.scrollTo({ top: 0 });
  }
  window.retryQuizSession = retryQuizSession;

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
