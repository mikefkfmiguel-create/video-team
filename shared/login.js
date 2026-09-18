// Corre na pagina de login do 7Eventos. Recebe cfg = {user, password}.
// Devolve: 'submitted' | 'loginerror' | 'nologin' | 'not-login'
(function (cfg) {
  if (!/\/Account\/Login/i.test(location.pathname)) return 'not-login';
  var u = document.getElementById('UserName');
  var p = document.getElementById('Password');
  if (!u || !p) return 'nologin';
  if (document.querySelector('.validation-summary-errors li, .field-validation-error')) return 'loginerror';
  u.value = cfg.user;
  p.value = cfg.password;
  var rm = document.getElementById('RememberMe');
  if (rm) rm.checked = true;
  var btn = u.form.querySelector('input[type=submit], button[type=submit]');
  if (btn) btn.click(); else u.form.submit();
  return 'submitted';
})
