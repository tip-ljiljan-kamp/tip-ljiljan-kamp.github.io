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
  let mounted = false;

  function show(form, message = '') {
    for (const item of forms) item.hidden = item !== form;
    const title = form === el('nicknameForm') ? 'Vælg kaldenavn' : 'Log ind';
    showPanel(title);
    document.title = title + ' · Tip Ljiljan Kamp';
    el('loginStatus').textContent = message;
  }

  async function request(path, session, data) {
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
      cache: 'no-store'
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

  async function mount(current) {
    const page = '/' + location.pathname.slice(root.pathname.length).replace(/index\.html$/, '');
    const view = await request('/api/app/view?page=' + encodeURIComponent(page), current);
    const template = document.createElement('template');
    template.innerHTML = view.body;
    const content = document.createElement('div');
    content.hidden = true;
    content.append(template.content);
    document.body.append(content);
    window.ljiljanAuth = client;
    window.ljiljanAccountId = current.user.id;

    try {
      for (const source of view.scripts) {
        const url = URL.createObjectURL(new Blob([source], {type: 'text/javascript'}));
        try {
          await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = url;
            script.onload = resolve;
            script.onerror = () => reject(new Error('Appen kunne ikke åbnes. Genindlæs siden.'));
            document.head.append(script);
          });
        } finally {
          URL.revokeObjectURL(url);
        }
      }
    } catch (error) {
      content.remove();
      throw error;
    }

    const logout = document.createElement('button');
    logout.type = 'button';
    logout.className = 'secondary auth-logout';
    logout.textContent = 'Log ud';
    logout.addEventListener('click', signOut);
    content.querySelector('header .brand').after(logout);
    document.title = view.title;
    mounted = true;
    clearTimeout(loadingTimer);
    shell.remove();
    content.replaceWith(...content.childNodes);
  }

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
    if (mounted && event === 'SIGNED_OUT') location.reload();
  });
  window.addEventListener('pagehide', event => {
    if (event.persisted && mounted) document.body.hidden = true;
  });
  window.addEventListener('pageshow', async event => {
    if (!event.persisted || !mounted) return;
    const current = await session().catch(() => null);
    if (current?.user.id !== window.ljiljanAccountId) location.reload();
    else document.body.hidden = false;
  });
  loadingTimer = setTimeout(() => showPanel('Indlæser siden…'), 450);
  session().then(enter).catch(error => {
    showPanel('Appen kunne ikke åbnes');
    el('loginStatus').textContent = error.message || 'Login kunne ikke indlæses. Genindlæs siden.';
  });
})();
