(() => {
  const root = new URL('.', document.currentScript.src);
  const el = id => document.getElementById(id);
  const shell = el('loginShell');
  const panel = el('loginPanel');
  const forms = [el('emailForm'), el('codeForm'), el('nicknameForm')];
  let loadingTimer;

  function showPanel(title) {
    clearTimeout(loadingTimer);
    el('loginTitle').textContent = title;
    panel.hidden = false;
  }

  if (location.protocol === 'http:' && location.hostname === 'tipljiljankamp.dk') {
    showPanel('Sikker forbindelse');
    const link = document.createElement('a');
    link.href = 'https://mathiasalkhuori23.github.io/tip-ljiljan-kamp-web' +
      location.pathname + location.search + location.hash;
    link.textContent = 'Åbn appen på den sikre adresse';
    el('loginStatus').replaceChildren('Login kræver en sikker forbindelse. ', link);
    return;
  }
  const config = window.LJILJAN_BACKEND;
  if (!window.supabase || !config) {
    showPanel('Appen kunne ikke åbnes');
    el('loginStatus').textContent = 'Login kunne ikke indlæses. Prøv at genindlæse siden.';
    return;
  }
  const client = window.supabase.createClient(config.url, config.key, {
    auth: {detectSessionInUrl: false, storageKey: 'ljiljan-auth:' + config.url}
  });
  const guestSessionKey = 'ljiljan:session:' + config.url;
  let email = '';
  let busy = false;
  let activeView;
  let navigation;

  function show(form, message = '') {
    for (const item of forms) item.hidden = item !== form;
    const title = form === el('nicknameForm') ? 'Vælg kaldenavn' : 'Log ind';
    showPanel(title);
    document.title = title + ' · Tip Ljiljan Kamp';
    el('loginStatus').textContent = message;
  }

  async function request(path, session, data, signal) {
    const headers = {
      apikey: config.key,
      Authorization: 'Bearer ' + session.access_token
    };
    if (path === '/api/account') {
      const legacy = localStorage.getItem(guestSessionKey);
      if (legacy) headers['X-Ljiljan-Session'] = legacy;
    }
    if (data) headers['Content-Type'] = 'application/json';
    const response = await fetch(config.url + '/functions/v1/ljiljan' + path, {
      headers, method: data ? 'POST' : 'GET', body: data ? JSON.stringify(data) : undefined,
      cache: 'no-store', signal
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(result.error || 'Appen kunne ikke åbnes. Prøv igen.');
      error.status = response.status;
      throw error;
    }
    return result;
  }

  async function session() {
    const {data, error} = await client.auth.getSession();
    if (error) throw error;
    return data.session;
  }

  function pagePath(destination) {
    return '/' + destination.pathname.slice(root.pathname.length).replace(/index\.html$/, '');
  }

  async function mount(current, destination = new URL(location.href), pending) {
    const view = await request('/api/app/view?page=' + encodeURIComponent(pagePath(destination)), current, undefined, pending?.signal);
    const template = document.createElement('template');
    template.innerHTML = view.body;
    for (const element of template.content.querySelectorAll('[href], [src]')) {
      for (const attribute of ['href', 'src']) {
        if (element.hasAttribute(attribute)) {
          element.setAttribute(attribute, new URL(element.getAttribute(attribute), destination).href);
        }
      }
    }
    const content = document.createElement('div');
    content.append(template.content);
    const lifetime = new AbortController();
    const intervals = [];
    lifetime.signal.addEventListener('abort', () => intervals.forEach(id => clearInterval(id)), {once:true});
    const viewDocument = {
      getElementById: id => content.querySelector('#' + CSS.escape(id)),
      querySelectorAll: selector => content.querySelectorAll(selector),
      createElement: name => document.createElement(name)
    };
    const viewWindow = {
      LJILJAN_BACKEND: config,
      ljiljanAuth: client,
      ljiljanAccountId: current.user.id,
      addEventListener: (name, listener) => window.addEventListener(name, listener, {signal:lifetime.signal})
    };
    const startInterval = (callback, delay) => {
      const id = setInterval(callback, delay);
      intervals.push(id);
      return id;
    };
    try {
      if (view.scripts.length) {
        const source = 'export default function (document, window, location, setInterval) {\n' +
          view.scripts.join('\n') + '\n}';
        const url = URL.createObjectURL(new Blob([source], {type:'text/javascript'}));
        try {
          const {default:initialize} = await import(url);
          if (pending?.signal.aborted) {
            lifetime.abort();
            return;
          }
          initialize(viewDocument, viewWindow, destination, startInterval);
        } finally {
          URL.revokeObjectURL(url);
        }
      }
    } catch (error) {
      lifetime.abort();
      throw error;
    }

    const logout = document.createElement('button');
    logout.type = 'button';
    logout.className = 'secondary auth-logout';
    logout.textContent = 'Log ud';
    logout.addEventListener('click', signOut);
    content.querySelector('header .brand').after(logout);
    if (pending?.signal.aborted) {
      lifetime.abort();
      return;
    }
    if (pending?.push) history.pushState(null, '', destination.href);
    const previous = activeView;
    (previous?.content ?? shell).replaceWith(content);
    previous?.lifetime.abort();
    activeView = {content, lifetime, destination, accountId:current.user.id};
    if (pending) {
      window.scrollTo(0, 0);
      content.querySelector('.site-tabs [aria-current="page"]')?.focus({preventScroll:true});
    }
    document.title = view.title;
    clearTimeout(loadingTimer);
  }

  const menuPages = new Set(['/', '/mine-tips/', '/saesontips/', '/rangliste/', '/praemie/', '/stats/']);

  function isMenuPage(destination) {
    return destination.origin === location.origin && destination.pathname.startsWith(root.pathname) &&
      menuPages.has(pagePath(destination));
  }

  async function navigate(destination, push) {
    navigation?.abort();
    const next = new AbortController();
    navigation = next;
    try {
      const current = await session();
      if (next.signal.aborted) return;
      if (current?.user.id !== activeView.accountId) throw new Error('Login kræves.');
      await mount(current, destination, {signal:next.signal, push});
    } catch {
      if (!next.signal.aborted) location.assign(destination.href);
    } finally {
      if (navigation === next) navigation = undefined;
    }
  }

  document.addEventListener('click', event => {
    const link = event.target.closest('.site-tabs a[href]');
    if (!activeView || !link || event.defaultPrevented || event.button !== 0 ||
        event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || link.target) return;
    const destination = new URL(link.href);
    if (!isMenuPage(destination)) return;
    event.preventDefault();
    if (destination.href !== location.href) void navigate(destination, true);
    else navigation?.abort();
  });
  window.addEventListener('popstate', () => {
    const destination = new URL(location.href);
    if (!activeView || !isMenuPage(destination)) return;
    const previous = activeView.destination;
    if (previous.pathname !== destination.pathname || previous.search !== destination.search) {
      void navigate(destination, false);
    } else {
      navigation?.abort();
    }
  });

  async function enter(current) {
    if (!current) {
      show(el('emailForm'));
      return;
    }
    try {
      await mount(current);
      return;
    } catch (error) {
      if (error.status === 401) {
        show(el('emailForm'), 'Log ind igen for at fortsætte.');
        return;
      }
      if (error.status !== 403) throw error;
    }
    const profile = await request('/api/account', current);
    if (profile.name) {
      await mount(current);
      return;
    }
    el('loginNickname').value = profile.legacyName;
    el('legacyOption').hidden = !profile.legacyName;
    el('claimLegacy').checked = false;
    el('legacyLabel').textContent = 'Tilknyt de gemte kamptips fra denne browser (' + profile.legacyName + ')';
    show(el('nicknameForm'));
    el('loginNickname').focus();
  }

  async function signOut(event) {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const {error} = await client.auth.signOut({scope: 'local'});
      if (error) throw error;
      location.reload();
    } catch {
      button.textContent = 'Prøv at logge ud igen';
      button.disabled = false;
    }
  }

  function submit(form, action) {
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy) return;
      busy = true;
      const button = form.querySelector('[type="submit"]');
      button.disabled = true;
      el('loginStatus').textContent = '';
      try {
        await action();
      } catch (error) {
        el('loginStatus').textContent = error.message || 'Noget gik galt. Prøv igen.';
      } finally {
        busy = false;
        button.disabled = false;
      }
    });
  }

  submit(el('emailForm'), async () => {
    email = el('loginEmail').value.trim();
    const {error} = await client.auth.signInWithOtp({email});
    if (error) throw new Error(error.status === 429 ? 'Vent et øjeblik, før du beder om en ny kode.' : 'Koden kunne ikke sendes. Tjek din e-mailadresse og prøv igen.');
    el('codeDestination').textContent = 'Koden er sendt til ' + email + '.';
    el('loginCode').value = '';
    show(el('codeForm'));
    el('loginCode').focus();
  });

  submit(el('codeForm'), async () => {
    const {data, error} = await client.auth.verifyOtp({
      email, token: el('loginCode').value.trim(), type: 'email'
    });
    if (error || !data.session) throw new Error('Koden er ugyldig eller udløbet. Prøv igen.');
    await enter(data.session);
  });

  submit(el('nicknameForm'), async () => {
    const current = await session();
    if (!current) { show(el('emailForm')); return; }
    const claimLegacy = el('claimLegacy').checked;
    const profile = await request('/api/account', current, {name: el('loginNickname').value, claimLegacy});
    if (profile.linkedLegacy) {
      try {
        const guest = JSON.parse(localStorage.getItem('ljiljan-tip-demo-v2'));
        const accountKey = 'ljiljan-tip-demo-v2:' + current.user.id;
        if (guest?.season && !localStorage.getItem(accountKey)) {
          localStorage.setItem(accountKey, JSON.stringify({tips: {}, season: guest.season}));
        }
      } catch {
        // Server-side kamptips are already linked.
      }
    }
    if (profile.linkedLegacy) localStorage.removeItem(guestSessionKey);
    await mount(current);
  });

  el('changeEmail').addEventListener('click', () => {
    if (busy) return;
    show(el('emailForm'));
    el('loginEmail').focus();
  });
  el('loginSignout').addEventListener('click', signOut);
  client.auth.onAuthStateChange(event => {
    if (activeView && event === 'SIGNED_OUT') location.reload();
  });
  window.addEventListener('pagehide', event => {
    if (event.persisted && activeView) document.body.hidden = true;
  });
  window.addEventListener('pageshow', async event => {
    if (!event.persisted || !activeView) return;
    const current = await session().catch(() => null);
    if (current?.user.id !== activeView.accountId) location.reload();
    else document.body.hidden = false;
  });
  loadingTimer = setTimeout(() => showPanel('Indlæser siden…'), 450);
  session().then(enter).catch(error => {
    showPanel('Appen kunne ikke åbnes');
    el('loginStatus').textContent = error.message || 'Login kunne ikke indlæses. Genindlæs siden.';
  });
})();
