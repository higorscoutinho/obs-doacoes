// Funções compartilhadas entre painel.html e overlay.html (Firebase Realtime Database via REST + SSE)
window.DOA = (function () {
  var DEF = {
    aC1: '#ffb703', aC2: '#fb5607', aTx: '#1a0f00', aOp: 94, aX: 3, aY: 12,
    rBg: '#000000', rAc: '#ffb703', rTx: '#ffffff', rOp: 70, rX: 69, rY: 24,
    rTitle: 'Maiores doadores', dur: 3, topn: 5, som: true, aS: 100, rS: 100
  };
  var COR = { aC1: 1, aC2: 1, aTx: 1, rBg: 1, rAc: 1, rTx: 1 };
  var NUM = { aOp: [10, 100], aX: [0, 90], aY: [0, 90], rOp: [0, 100], rX: [0, 90], rY: [0, 90], dur: [2, 10], topn: [1, 15], aS: [50, 200], rS: [50, 200] };

  function brl(n) { return Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  function hexA(h, a) {
    var n = parseInt(String(h).slice(1), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  // Junta a aparência salva com o padrão, descartando valores inválidos
  function merge(c) {
    var o = {}, k;
    for (k in DEF) o[k] = DEF[k];
    c = c || {};
    for (k in COR) if (/^#[0-9a-fA-F]{6}$/.test(String(c[k]))) o[k] = c[k];
    for (k in NUM) {
      var n = Number(c[k]);
      if (c[k] !== undefined && c[k] !== null && c[k] !== '' && !isNaN(n)) o[k] = Math.min(NUM[k][1], Math.max(NUM[k][0], n));
    }
    if (typeof c.rTitle === 'string' && c.rTitle) o.rTitle = c.rTitle.slice(0, 30);
    if (typeof c.som === 'boolean') o.som = c.som;
    return o;
  }

  /* ---------- Configuração ---------- */
  function FB() { return window.DOA_FB || {}; }
  function fbOk() {
    var c = FB();
    return !!(c.apiKey && c.databaseURL && c.email) &&
      String(c.apiKey).indexOf('COLE') < 0 && String(c.databaseURL).indexOf('COLE') < 0 &&
      /^https?:\/\//.test(c.databaseURL);
  }
  function dbUrl(path, q) { return String(FB().databaseURL).replace(/\/$/, '') + path + '.json' + (q || ''); }

  /* ---------- Leitura em tempo real (SSE) ---------- */
  // Mantém uma cópia local de `path` e chama onData(dadosAtuais, {initial}) a cada mudança.
  function stream(path, onData, onStatus) {
    var local = null, es = null;
    function setAt(p, data) {
      if (p === '/') { local = data; return; }
      var parts = p.split('/').filter(Boolean);
      if (local === null || typeof local !== 'object') local = {};
      var o = local, i;
      for (i = 0; i < parts.length - 1; i++) {
        if (o[parts[i]] === null || o[parts[i]] === undefined || typeof o[parts[i]] !== 'object') o[parts[i]] = {};
        o = o[parts[i]];
      }
      var k = parts[parts.length - 1];
      if (data === null) delete o[k]; else o[k] = data;
    }
    function apply(p, data, isPatch) {
      if (isPatch) {
        Object.keys(data || {}).forEach(function (k) { setAt((p === '/' ? '' : p) + '/' + k, data[k]); });
      } else setAt(p, data);
      onData(local, { initial: p === '/' && !isPatch });
    }
    function open() {
      es = new EventSource(dbUrl(path));
      es.addEventListener('open', function () { if (onStatus) onStatus(true); });
      es.addEventListener('put', function (e) { var m = JSON.parse(e.data); apply(m.path, m.data, false); });
      es.addEventListener('patch', function (e) { var m = JSON.parse(e.data); apply(m.path, m.data, true); });
      es.addEventListener('error', function () {
        if (onStatus) onStatus(false);
        if (es.readyState === 2) setTimeout(open, 3000);   // fechou de vez: reabre
      });
      es.addEventListener('cancel', function () { es.close(); setTimeout(open, 3000); });
    }
    open();
  }

  function get(path) {
    return fetch(dbUrl(path), { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('Erro ' + r.status);
      return r.json();
    });
  }

  /* ---------- Login (e-mail fixo + senha) e escrita ---------- */
  var A = { id: '', ref: '', exp: 0 };
  try { var salvo = JSON.parse(localStorage.getItem('doa_auth') || 'null'); if (salvo && salvo.ref) A = salvo; } catch (e) {}
  function saveAuth() {
    try { if (A.ref) localStorage.setItem('doa_auth', JSON.stringify(A)); else localStorage.removeItem('doa_auth'); } catch (e) {}
  }
  function hasSession() { return !!A.ref; }
  function logout() { A = { id: '', ref: '', exp: 0 }; saveAuth(); }

  function login(senha) {
    var c = FB(), base = c.identityHost || 'https://identitytoolkit.googleapis.com';
    return fetch(base + '/v1/accounts:signInWithPassword?key=' + encodeURIComponent(c.apiKey), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: c.email, password: senha, returnSecureToken: true })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j.error) {
        var m = String(j.error.message || '');
        if (/INVALID_PASSWORD|INVALID_LOGIN_CREDENTIALS|EMAIL_NOT_FOUND/.test(m)) throw new Error('Senha incorreta');
        if (/TOO_MANY/.test(m)) throw new Error('Muitas tentativas. Aguarde alguns minutos.');
        if (/OPERATION_NOT_ALLOWED/.test(m)) throw new Error('Ative o login por e-mail/senha no Firebase (Authentication).');
        throw new Error('Erro de login: ' + m);
      }
      A = { id: j.idToken, ref: j.refreshToken, exp: Date.now() + (Number(j.expiresIn) - 120) * 1000 };
      saveAuth();
    });
  }

  function token() {
    if (!A.ref) return Promise.reject(new Error('Sessão expirada'));
    if (A.id && Date.now() < A.exp) return Promise.resolve(A.id);
    var c = FB(), base = c.tokenHost || 'https://securetoken.googleapis.com';
    return fetch(base + '/v1/token?key=' + encodeURIComponent(c.apiKey), {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(A.ref)
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j.error || !j.id_token) { logout(); throw new Error('Sessão expirada'); }
      A = { id: j.id_token, ref: j.refresh_token || A.ref, exp: Date.now() + (Number(j.expires_in) - 120) * 1000 };
      saveAuth();
      return A.id;
    });
  }

  function db(method, path, body) {
    return token().then(function (t) {
      return fetch(dbUrl(path, '?auth=' + encodeURIComponent(t)), {
        method: method, body: body === undefined ? undefined : JSON.stringify(body)
      });
    }).then(function (r) {
      if (r.status === 401 || r.status === 403) throw new Error('Sem permissão. Confira as regras do banco e o e-mail em config.js.');
      if (!r.ok) throw new Error('Erro ' + r.status);
      return r.json();
    });
  }

  return {
    DEF: DEF, brl: brl, hexA: hexA, merge: merge, fbOk: fbOk,
    stream: stream, get: get, login: login, hasSession: hasSession, logout: logout, token: token, db: db
  };
})();
