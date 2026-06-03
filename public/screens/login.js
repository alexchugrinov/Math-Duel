const LoginScreen = (() => {
  let activeTab = 'login';

  function init(container) {
    container.innerHTML = `
      <div class="screen">
        <div class="card">
          <h1>Math Duel</h1>
          <p class="subtitle">Challenge friends to a math showdown</p>
          <div class="tabs">
            <button class="tab-btn active" id="tab-login">Login</button>
            <button class="tab-btn" id="tab-register">Register</button>
          </div>
          <div class="form-group">
            <label for="input-username">Username</label>
            <input id="input-username" type="text" placeholder="Enter username" autocomplete="username" maxlength="20">
          </div>
          <div class="form-group">
            <label for="input-password">Password</label>
            <input id="input-password" type="password" placeholder="Enter password" autocomplete="current-password">
          </div>
          <div class="error-msg" id="auth-error"></div>
          <button class="btn btn-primary mt8" id="btn-submit">Login</button>
        </div>
      </div>
    `;

    container.querySelector('#tab-login').addEventListener('click', () => switchTab('login', container));
    container.querySelector('#tab-register').addEventListener('click', () => switchTab('register', container));
    container.querySelector('#btn-submit').addEventListener('click', () => submit(container));
    container.querySelector('#input-password').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit(container);
    });
    container.querySelector('#input-username').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') container.querySelector('#input-password').focus();
    });
  }

  function switchTab(tab, container) {
    activeTab = tab;
    container.querySelector('#tab-login').classList.toggle('active', tab === 'login');
    container.querySelector('#tab-register').classList.toggle('active', tab === 'register');
    container.querySelector('#btn-submit').textContent = tab === 'login' ? 'Login' : 'Create Account';
    container.querySelector('#auth-error').textContent = '';
    const pwInput = container.querySelector('#input-password');
    pwInput.autocomplete = tab === 'login' ? 'current-password' : 'new-password';
  }

  async function submit(container) {
    const username = container.querySelector('#input-username').value.trim();
    const password = container.querySelector('#input-password').value;
    const errEl = container.querySelector('#auth-error');
    const btn = container.querySelector('#btn-submit');

    errEl.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Please wait…';

    try {
      let result;
      if (activeTab === 'login') {
        result = await API.login(username, password);
      } else {
        result = await API.register(username, password);
      }
      App.setUser(result.user, result.token);
      Socket.connect(result.token);
      App.navigate('home');
    } catch (err) {
      const msgs = {
        invalid_credentials: 'Wrong username or password.',
        username_taken: 'Username is already taken.',
        invalid_username: 'Username must be 3–20 alphanumeric characters.',
        password_too_short: 'Password must be at least 6 characters.',
        missing_fields: 'Please fill in all fields.',
      };
      errEl.textContent = msgs[err.error] || 'Something went wrong. Try again.';
      btn.disabled = false;
      btn.textContent = activeTab === 'login' ? 'Login' : 'Create Account';
    }
  }

  function destroy() {}

  return { init, destroy };
})();
