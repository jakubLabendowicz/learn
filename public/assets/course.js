/* Generic course engine: renders /courses/{slug} from /courses/{slug}.json */
(function () {
  const app = document.getElementById('course-app');
  const topbar = document.getElementById('course-topbar');
  const footer = document.getElementById('course-footer');

  const slug = decodeURIComponent(location.pathname.replace(/^\/courses\//, '').replace(/\/$/, ''));

  let COURSE = null;
  let MODULES = null;
  let ROUTE = { view: 'overview' };
  let QUIZ_STATE = null;
  let SETUP = { scope: null, max: 0, selected: 0, isFinal: false };

  fetch(`/courses/${slug}.json`)
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

    render();
  }

  function stateEntry() {
    return learnLoadState().courses[COURSE.id];
  }

  function updateTopbar() {
    const pct = learnCourseProgress(stateEntry());
    document.getElementById('course-topbar-pct').textContent = pct + '% ukończone';
    document.getElementById('course-topbar-bar-fill').style.width = pct + '%';
  }

  function moduleById(id) { return MODULES.find(m => m.id === id); }

  function findItem(itemId) {
    for (const m of MODULES) {
      for (const it of m.items) {
        if (it.id === itemId) return { module: m, item: it };
      }
    }
    return null;
  }

  function renderInPlace() {
    if (ROUTE.view === 'overview') app.innerHTML = renderOverview();
    else if (ROUTE.view === 'article') app.innerHTML = renderArticle(ROUTE.moduleId);
    else if (ROUTE.view === 'quiz-setup') app.innerHTML = renderQuizSetup();
    else if (ROUTE.view === 'quiz-run') app.innerHTML = renderQuizRun();
    else if (ROUTE.view === 'quiz-results') app.innerHTML = renderQuizResults();
    updateTopbar();
  }

  function render() {
    renderInPlace();
    window.scrollTo({ top: 0 });
  }

  function goOverview() { ROUTE = { view: 'overview' }; render(); }
  function goArticle(moduleId) { ROUTE = { view: 'article', moduleId }; render(); }
  function goQuizTab(moduleId) { openQuizSetup(moduleId); }
  function goFinalQuiz() { openQuizSetup(null); }
  window.goOverview = goOverview;
  window.goArticle = goArticle;
  window.goQuizTab = goQuizTab;
  window.goFinalQuiz = goFinalQuiz;

  // ---------------- Overview ----------------

  function quizItemOf(mod) { return mod.items.find(i => i.type === 'quiz'); }
  function articleItemOf(mod) { return mod.items.find(i => i.type === 'article'); }

  function moduleQuizAttempts(entry, quizId) {
    return (entry.quizAttempts || []).filter(a => a.itemId === quizId);
  }
  function bestAttempt(attempts) {
    if (!attempts.length) return null;
    return attempts.reduce((best, a) => (!best || a.pct > best.pct ? a : best), null);
  }

  function renderOverview() {
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
      const articleItem = articleItemOf(m);
      const quizItem = quizItemOf(m);
      const read = entry.articlesRead[articleItem.id];
      const attempts = moduleQuizAttempts(entry, quizItem.id);
      const best = bestAttempt(attempts);
      const pillClass = best ? (COURSE.passThreshold ? (best.pct >= COURSE.passThreshold ? 'good' : 'bad') : (best.pct >= 70 ? 'good' : '')) : '';
      return `
        <div class="module-row" onclick="goArticle('${m.id}')">
          <div class="module-num">${m.icon || String(idx + 1).padStart(2, '0')}</div>
          <div class="module-row-body">
            <div class="module-row-title">${escapeHtml(m.title)}</div>
            <div class="module-row-meta">
              ${m.weight != null ? `<span>Waga egzaminu: ${m.weight}%</span>` : ''}
              <span>${quizItem.questions.length} pytań</span>
              <span>${read ? 'Artykuł przeczytany' : 'Artykuł nieprzeczytany'}</span>
            </div>
          </div>
          <div class="module-row-status">
            ${best ? `<span class="pct-pill ${pillClass}">${best.pct}%</span>` : `<span class="pct-pill">— %</span>`}
          </div>
        </div>`;
    }).join('');

    const totalFinalQ = MODULES.reduce((s, m) => s + quizItemOf(m).questions.length, 0);
    const finalAttempts = moduleQuizAttempts(entry, 'final-quiz');
    const finalBest = bestAttempt(finalAttempts);
    const finalPillClass = finalBest ? (COURSE.passThreshold ? (finalBest.pct >= COURSE.passThreshold ? 'good' : 'bad') : (finalBest.pct >= 70 ? 'good' : '')) : '';

    const finalRow = `
      <div class="module-row final" onclick="goFinalQuiz()">
        <div class="module-num">🏁</div>
        <div class="module-row-body">
          <div class="module-row-title">${escapeHtml(COURSE.finalQuizTitle || 'Egzamin końcowy')}</div>
          <div class="module-row-meta"><span>${COURSE.finalQuizDescription || `${totalFinalQ} pytań ze wszystkich modułów`}</span></div>
        </div>
        <div class="module-row-status">
          ${finalBest ? `<span class="pct-pill ${finalPillClass}">${finalBest.pct}%</span>` : `<span class="pct-pill">— %</span>`}
        </div>
      </div>`;

    return `
      <div class="course-hero">
        <span class="course-hero-eyebrow">${escapeHtml(COURSE.shortTitle || 'Kurs')}</span>
        <h1>${escapeHtml(COURSE.title)}</h1>
        <p>${escapeHtml(COURSE.description || '')}</p>
        ${weightbar}
      </div>
      <div class="module-list">
        ${rows}
        ${finalRow}
      </div>`;
  }

  // ---------------- Article ----------------

  function renderArticle(moduleId) {
    const m = moduleById(moduleId);
    const item = articleItemOf(m);
    const entry = stateEntry();
    const alreadyRead = !!entry.articlesRead[item.id];
    if (!alreadyRead) {
      const newState = learnMarkArticleRead(
        { id: COURSE.id, slug: COURSE.slug, title: COURSE.title, icon: COURSE.icon, accent: COURSE.accent, totalArticles: entry.totalArticles, totalQuizzes: entry.totalQuizzes },
        m, item
      );
    }
    const idx = MODULES.indexOf(m);
    const html = renderMarkdown(item.content);

    return `
      <button class="back-link" onclick="goOverview()">← Wróć do planu kursu</button>
      <div class="module-head">
        <div class="module-head-eyebrow">Moduł ${idx + 1} / ${MODULES.length}${m.weight != null ? ` · Waga: ${m.weight}%` : ''}</div>
        <h1>${escapeHtml(m.title)}</h1>
        <div class="module-tabs">
          <div class="module-tab active">Artykuł</div>
          <div class="module-tab" onclick="goQuizTab('${m.id}')">Quiz</div>
        </div>
      </div>
      <div class="article-card">
        <div class="article-body">${html}</div>
        <div class="article-footer">
          <div class="mark-read-note">✓ Artykuł oznaczony jako przeczytany</div>
          <button class="course-btn" onclick="goQuizTab('${m.id}')">Przejdź do quizu →</button>
        </div>
      </div>`;
  }

  // ---------------- Quiz setup ----------------

  function getPool(moduleId) {
    if (!moduleId) {
      let pool = [];
      MODULES.forEach(m => pool.push(...quizItemOf(m).questions));
      return pool;
    }
    const m = moduleById(moduleId);
    return quizItemOf(m).questions.slice();
  }

  function openQuizSetup(moduleId) {
    const pool = getPool(moduleId);
    SETUP = { scope: moduleId, max: pool.length, selected: pool.length, isFinal: !moduleId };
    ROUTE = { view: 'quiz-setup' };
    render();
  }
  window.openQuizSetup = openQuizSetup;

  function renderQuizSetup() {
    const isFinal = SETUP.isFinal;
    const mod = isFinal ? null : moduleById(SETUP.scope);
    const icon = isFinal ? '🏁' : (mod.icon || '📝');
    const title = isFinal ? (COURSE.finalQuizTitle || 'Egzamin końcowy') : `Quiz: ${mod.title}`;

    const presets = [5, 10, 15, 20, 25].filter(n => n < SETUP.max);
    const optionsHtml = presets.map(n => `
        <div class="setup-opt ${SETUP.selected === n ? 'selected' : ''}" onclick="selectSetupCount(${n})">${n}</div>
      `).join('') + `
        <div class="setup-opt ${SETUP.selected === SETUP.max ? 'selected' : ''}" onclick="selectSetupCount(${SETUP.max})">
          ${SETUP.max}<span class="setup-opt-label">Wszystkie</span>
        </div>`;

    return `
      <button class="back-link" onclick="goOverview()">← Wróć do planu kursu</button>
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
    renderInPlace();
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
    startQuiz(SETUP.scope, count, SETUP.isFinal);
  }
  window.confirmStartQuiz = confirmStartQuiz;

  // ---------------- Quiz run ----------------

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function startQuiz(moduleId, count, isFinal) {
    const pool = getPool(moduleId);
    const shuffled = shuffle(pool).slice(0, count);
    QUIZ_STATE = {
      moduleId, isFinal,
      questions: shuffled,
      index: 0,
      score: 0,
      wrong: 0,
      answers: {},
      optionOrder: {},
      multiSelection: [],
    };
    shuffled.forEach(q => { QUIZ_STATE.optionOrder[q.id] = shuffle(q.options.map(o => o.key)); });
    ROUTE = { view: 'quiz-run' };
    render();
  }

  function currentQuestion() { return QUIZ_STATE.questions[QUIZ_STATE.index]; }

  function renderQuizRun() {
    const q = currentQuestion();
    const total = QUIZ_STATE.questions.length;
    const idx = QUIZ_STATE.index;
    const answered = QUIZ_STATE.answers[q.id];
    const isMulti = q.answer.length > 1;
    const keys = QUIZ_STATE.optionOrder[q.id];
    const pct = Math.round((idx / total) * 100);
    const answeredCount = idx;
    const scorePct = answeredCount > 0 ? Math.round((QUIZ_STATE.score / answeredCount) * 100) : 0;

    const optsHtml = keys.map(k => {
      const opt = q.options.find(o => o.key === k);
      let cls = 'opt';
      const isSelected = answered ? answered.includes(k) : QUIZ_STATE.multiSelection.includes(k);
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
    const multiReady = QUIZ_STATE.multiSelection.length === q.answer.length;
    const nextBtn = answered
      ? `<button class="course-btn" onclick="nextQuestion()">${nextLabel}</button>`
      : (isMulti ? `<button class="course-btn" id="confirm-multi-btn" onclick="confirmMulti()" ${multiReady ? '' : 'disabled'}>Zatwierdź odpowiedź (${q.answer.length})</button>` : '');

    return `
      <button class="back-link" onclick="confirmExitQuiz()">← Przerwij quiz</button>
      <div class="quiz-hud">
        <span>Pytanie <b>${idx + 1} / ${total}</b></span>
        <span><span class="correct-c">Poprawne <b>${QUIZ_STATE.score}</b></span> &nbsp; <span class="wrong-c">Błędne <b>${QUIZ_STATE.wrong}</b></span> &nbsp; Wynik <b>${scorePct}%</b></span>
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
    if (QUIZ_STATE.answers[q.id]) return;
    const isMulti = q.answer.length > 1;
    if (!isMulti) {
      submitAnswer([k]);
      return;
    }
    const i = QUIZ_STATE.multiSelection.indexOf(k);
    if (i > -1) QUIZ_STATE.multiSelection.splice(i, 1); else QUIZ_STATE.multiSelection.push(k);
    renderInPlace();
  }
  window.selectOption = selectOption;

  function confirmMulti() {
    submitAnswer(QUIZ_STATE.multiSelection.slice());
    QUIZ_STATE.multiSelection = [];
  }
  window.confirmMulti = confirmMulti;

  function submitAnswer(selectedKeys) {
    const q = currentQuestion();
    QUIZ_STATE.answers[q.id] = selectedKeys;
    const userSet = new Set(selectedKeys);
    const correctSet = new Set(q.answer);
    const isCorrect = userSet.size === correctSet.size && [...userSet].every(k => correctSet.has(k));
    if (isCorrect) QUIZ_STATE.score++; else QUIZ_STATE.wrong++;
    render();
  }

  function nextQuestion() {
    QUIZ_STATE.index++;
    if (QUIZ_STATE.index >= QUIZ_STATE.questions.length) finishQuiz();
    else render();
  }
  window.nextQuestion = nextQuestion;

  function confirmExitQuiz() {
    if (confirm('Czy na pewno chcesz przerwać quiz? Postęp tego podejścia nie zostanie zapisany.')) {
      ROUTE = { view: 'overview' };
      render();
    }
  }
  window.confirmExitQuiz = confirmExitQuiz;

  function finishQuiz() {
    const total = QUIZ_STATE.questions.length;
    const pct = Math.round((QUIZ_STATE.score / total) * 100);
    const mod = QUIZ_STATE.isFinal ? null : moduleById(QUIZ_STATE.moduleId);
    const item = QUIZ_STATE.isFinal
      ? { id: 'final-quiz', title: COURSE.finalQuizTitle || 'Egzamin końcowy' }
      : quizItemOf(mod);

    const entry = stateEntry();
    learnRecordQuizAttempt(
      { id: COURSE.id, slug: COURSE.slug, title: COURSE.title, icon: COURSE.icon, accent: COURSE.accent, totalArticles: entry.totalArticles, totalQuizzes: entry.totalQuizzes },
      mod, item, { score: QUIZ_STATE.score, total, pct }
    );

    ROUTE = { view: 'quiz-results' };
    render();
  }

  function renderQuizResults() {
    const total = QUIZ_STATE.questions.length;
    const score = QUIZ_STATE.score;
    const wrong = QUIZ_STATE.wrong;
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

    const reviewHtml = QUIZ_STATE.questions.map((q, i) => {
      const ans = QUIZ_STATE.answers[q.id] || [];
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

    const retryLabel = QUIZ_STATE.isFinal ? 'goFinalQuiz()' : `openQuizSetup('${QUIZ_STATE.moduleId}')`;

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
          <button class="course-btn" onclick="${retryLabel}">🔄 Powtórz</button>
          <button class="btn-secondary" onclick="goOverview()">← Wróć do planu kursu</button>
        </div>
        <div class="review-section">
          <h3>📋 Przegląd odpowiedzi</h3>
          ${reviewHtml}
        </div>
      </div>`;
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
