/**
 * Self-contained login page. Kept as a string rather than a file so it works
 * identically from the packaged asar and from `out/` in development, and so it
 * never depends on the renderer bundle having been built.
 */
export const LOGIN_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SincroGitExclude</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: #0a0a0b; color: #e7e5e4;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  form {
    width: min(92vw, 360px); background: #141416; border: 1px solid #26262a;
    border-radius: 10px; padding: 30px 28px 26px;
  }
  h1 { font-size: 1.05rem; font-weight: 600; margin: 0 0 6px; letter-spacing: -.01em; }
  p.hint { font-size: .82rem; color: #8b8b8f; margin: 0 0 22px; line-height: 1.5; }
  label { display: block; font-size: .76rem; color: #a1a1a6; margin-bottom: 7px; }
  input {
    width: 100%; padding: 10px 12px; border-radius: 6px; border: 1px solid #303035;
    background: #0f0f11; color: #e7e5e4; font-size: .9rem;
    font-family: ui-monospace, Consolas, monospace;
  }
  input:focus { outline: none; border-color: #4f7fbf; }
  button {
    width: 100%; margin-top: 16px; padding: 10px 12px; border: 0; border-radius: 6px;
    background: #3f6fae; color: #fff; font-size: .88rem; font-weight: 600; cursor: pointer;
  }
  button:hover { background: #4a7cbd; }
  button:disabled { opacity: .6; cursor: default; }
  .error {
    margin-top: 14px; font-size: .82rem; color: #f0a89c;
    background: #2c1714; border: 1px solid #4a231d; border-radius: 6px; padding: 9px 11px;
  }
  .error[hidden] { display: none; }
</style>
</head>
<body>
<form id="f">
  <h1>SincroGitExclude</h1>
  <p class="hint">Introduce el token de acceso. Lo encuentras en Ajustes &rarr; Acceso web, en la maquina que ejecuta la aplicacion.</p>
  <label for="t">Token de acceso</label>
  <input id="t" name="token" type="password" autocomplete="current-password" autofocus required>
  <button id="b" type="submit">Entrar</button>
  <div class="error" id="e" hidden></div>
</form>
<script>
  var form = document.getElementById('f');
  var errorBox = document.getElementById('e');
  var button = document.getElementById('b');

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    errorBox.hidden = true;
    button.disabled = true;

    fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: document.getElementById('t').value })
    })
      .then(function (response) {
        if (response.ok) {
          window.location.href = '/';
          return null;
        }
        return response.json().catch(function () {
          return { error: 'Error ' + response.status };
        });
      })
      .then(function (data) {
        if (!data) return;
        errorBox.textContent = data.error || 'Token invalido';
        errorBox.hidden = false;
        button.disabled = false;
      })
      .catch(function () {
        errorBox.textContent = 'No se pudo contactar con el servidor';
        errorBox.hidden = false;
        button.disabled = false;
      });
  });
</script>
</body>
</html>`

/** Shown when web mode is on but the renderer has not been built yet. */
export const NO_BUILD_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SincroGitExclude</title>
<style>
  :root { color-scheme: dark; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
    background: #0a0a0b; color: #e7e5e4;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  div { max-width: 460px; }
  h1 { font-size: 1.05rem; margin: 0 0 10px; }
  p { font-size: .88rem; color: #a1a1a6; line-height: 1.6; margin: 0 0 12px; }
  code { font-family: ui-monospace, Consolas, monospace; background: #1a1a1d; padding: 2px 6px; border-radius: 4px; }
</style>
</head>
<body>
<div>
  <h1>Cliente web no compilado</h1>
  <p>El servidor esta activo, pero no encuentra <code>out/renderer</code>.</p>
  <p>En desarrollo el cliente web necesita una compilacion del renderer: ejecuta <code>npm run build</code> una vez y recarga esta pagina. La ventana de escritorio sigue funcionando con hot reload.</p>
</div>
</body>
</html>`
