(function () {
  const YAML_RAW = `name: auth-signup-checkout
description: Signup → verify → checkout → premium
baseUrl: \${BASE_URL:-http://127.0.0.1:3847}
vars:
  email: demo+\${TIMESTAMP}@example.com
  password: secret123
steps:
  - id: signup
    type: http
    method: POST
    path: /signup
    body: { email: \${email}, password: \${password} }
    expect: { status: 201 }
    capture:
      verifyToken: $.verifyToken
      sessionToken: $.sessionToken

  - id: verify
    type: http
    method: POST
    path: /verify
    body: { token: \${verifyToken} }
    expect: { status: 200 }

  - id: checkout
    type: http
    method: POST
    path: /checkout
    headers: { Authorization: Bearer \${sessionToken} }
    expect: { status: 200 }

  - id: assert-premium
    type: assert
    http:
      method: GET
      path: /me
      headers: { Authorization: Bearer \${sessionToken} }
    expect:
      status: 200
      json: { plan: premium }`;

  const STEPS = [
    {
      id: 'signup',
      type: 'http',
      detail: 'POST /signup → 201 · capture verifyToken, sessionToken',
      durationMs: 42,
    },
    {
      id: 'verify',
      type: 'http',
      detail: 'POST /verify → 200 · email verified',
      durationMs: 18,
    },
    {
      id: 'checkout',
      type: 'http',
      detail: 'POST /checkout → 200 · mock Stripe → premium',
      durationMs: 31,
    },
    {
      id: 'assert-premium',
      type: 'assert',
      detail: 'GET /me · expect plan == premium',
      durationMs: 12,
    },
  ];

  function escapeHtml(s) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function highlightYaml(src) {
    return escapeHtml(src)
      .replace(/^(#.*)$/gm, '<span class="c">$1</span>')
      .replace(
        /^([A-Za-z_][\w-]*)(:)/gm,
        '<span class="k">$1</span>$2'
      )
      .replace(
        /(^|\s)(- )([A-Za-z_][\w-]*)(:)/gm,
        '$1$2<span class="k">$3</span>$4'
      )
      .replace(
        /(:\s*)(\$?\{?[^#\n{][^#\n]*|"[^"]*"|'[^']*'|\d+)/g,
        function (_, a, b) {
          if (/^\d+$/.test(b.trim())) return a + '<span class="n">' + b + '</span>';
          return a + '<span class="s">' + b + '</span>';
        }
      );
  }

  function renderYaml() {
    const el = document.getElementById('yaml-view');
    if (el) el.innerHTML = highlightYaml(YAML_RAW);
  }

  function renderSteps(state) {
    const report = document.getElementById('report');
    if (!report) return;
    report.innerHTML = STEPS.map(function (s, i) {
      const st = state[i] || 'pending';
      const icon =
        st === 'done' ? '✓' : st === 'fail' ? '✗' : st === 'running' ? '●' : '○';
      const cls =
        'step' +
        (st === 'done' ? ' done' : '') +
        (st === 'fail' ? ' fail' : '') +
        (st === 'running' ? ' running active' : '') +
        (st === 'pending' ? '' : ' active');
      const dur = st === 'done' || st === 'fail' ? s.durationMs + 'ms' : '';
      return (
        '<div class="' +
        cls +
        '" data-step="' +
        i +
        '">' +
        '<div class="step-icon">' +
        icon +
        '</div>' +
        '<div class="step-meta">' +
        '<div><span class="step-id">' +
        s.id +
        '</span><span class="step-type">' +
        s.type +
        '</span></div>' +
        '<div class="step-detail">' +
        s.detail +
        '</div>' +
        '</div>' +
        '<div class="step-dur">' +
        dur +
        '</div>' +
        '</div>'
      );
    }).join('');
  }

  let running = false;
  let timers = [];

  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
  }

  function reset() {
    clearTimers();
    running = false;
    const footer = document.getElementById('report-footer');
    if (footer) footer.classList.remove('show');
    renderSteps(STEPS.map(function () { return 'pending'; }));
    const btn = document.getElementById('btn-run');
    if (btn) btn.disabled = false;
  }

  function run() {
    if (running) return;
    running = true;
    clearTimers();
    const btn = document.getElementById('btn-run');
    if (btn) btn.disabled = true;
    const footer = document.getElementById('report-footer');
    if (footer) footer.classList.remove('show');

    const state = STEPS.map(function () { return 'pending'; });
    renderSteps(state);

    let delay = 280;
    STEPS.forEach(function (_, i) {
      timers.push(
        setTimeout(function () {
          state[i] = 'running';
          renderSteps(state);
        }, delay)
      );
      delay += 420 + STEPS[i].durationMs * 4;
      timers.push(
        setTimeout(function () {
          state[i] = 'done';
          renderSteps(state);
          if (i === STEPS.length - 1) {
            if (footer) footer.classList.add('show');
            running = false;
            if (btn) btn.disabled = false;
          }
        }, delay)
      );
      delay += 180;
    });
  }

  function wireCopy() {
    document.querySelectorAll('[data-copy]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const text = btn.getAttribute('data-copy');
        navigator.clipboard.writeText(text).then(
          function () {
            btn.textContent = 'Copied';
            btn.classList.add('copied');
            setTimeout(function () {
              btn.textContent = 'Copy';
              btn.classList.remove('copied');
            }, 1400);
          },
          function () {
            btn.textContent = 'Failed';
          }
        );
      });
    });
  }

  function init() {
    renderYaml();
    reset();
    wireCopy();
    const runBtn = document.getElementById('btn-run');
    const resetBtn = document.getElementById('btn-reset');
    if (runBtn) runBtn.addEventListener('click', run);
    if (resetBtn) resetBtn.addEventListener('click', reset);
    // Auto-play once on landing if report exists
    if (runBtn && document.getElementById('report')) {
      setTimeout(run, 600);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
