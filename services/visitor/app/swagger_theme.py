"""
Dark / light / system theme support for Swagger UI.

Swagger UI ships no theming of its own and its JS/CSS are loaded straight
from a CDN (see fastapi.openapi.docs.get_swagger_ui_html), so there is no
hook to restyle it except post-processing the HTML it returns. This wraps
get_swagger_ui_html() and injects:
  - an early inline script (before any CSS) that resolves light/dark from
    localStorage — same "gmgt-theme-mode" key + light/dark/system values
    used by the frontend shell's ThemeModeContext — or the OS preference,
    and stamps it on <html data-theme> before first paint (no flash).
  - a <style> block with dark-mode overrides for swagger-ui's DOM.
  - a floating toggle button (Light/Dark/System) that persists the choice
    and re-resolves live if "system" and the OS preference changes.

Duplicated verbatim into every services/*/app — there is no shared package
between service containers (see CLAUDE.md), matching how e.g. middleware/
splunk.py is already duplicated per service rather than imported.
"""
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.responses import HTMLResponse

_STORAGE_KEY = "gmgt-theme-mode"

_THEME_INIT_SCRIPT = f"""
<script>
(function() {{
  var KEY = {_STORAGE_KEY!r};
  function resolve(mode) {{
    if (mode === 'dark' || mode === 'light') return mode;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }}
  var mode = localStorage.getItem(KEY) || 'system';
  document.documentElement.setAttribute('data-theme', resolve(mode));
}})();
</script>
"""

_DARK_CSS = """
<style>
html[data-theme="dark"] { color-scheme: dark; }
html[data-theme="dark"] body { background: #1b1b1f; }

html[data-theme="dark"] .swagger-ui { color: #d4d4d8; }

html[data-theme="dark"] .swagger-ui .topbar { background: #101012; border-bottom: 1px solid #333; }

html[data-theme="dark"] .swagger-ui .info .title,
html[data-theme="dark"] .swagger-ui .info li,
html[data-theme="dark"] .swagger-ui .info p,
html[data-theme="dark"] .swagger-ui .info table,
html[data-theme="dark"] .swagger-ui .opblock-tag,
html[data-theme="dark"] .swagger-ui .opblock-tag small,
html[data-theme="dark"] .swagger-ui .opblock .opblock-summary-operation-id,
html[data-theme="dark"] .swagger-ui .opblock .opblock-summary-path,
html[data-theme="dark"] .swagger-ui .opblock .opblock-summary-path__deprecated,
html[data-theme="dark"] .swagger-ui .opblock .opblock-summary-description,
html[data-theme="dark"] .swagger-ui .opblock-description-wrapper p,
html[data-theme="dark"] .swagger-ui .opblock-title_normal,
html[data-theme="dark"] .swagger-ui .tab li,
html[data-theme="dark"] .swagger-ui .response-col_status,
html[data-theme="dark"] .swagger-ui .response-col_links,
html[data-theme="dark"] .swagger-ui table thead tr td,
html[data-theme="dark"] .swagger-ui table thead tr th,
html[data-theme="dark"] .swagger-ui .parameter__name,
html[data-theme="dark"] .swagger-ui .parameter__type,
html[data-theme="dark"] .swagger-ui .parameter__in,
html[data-theme="dark"] .swagger-ui .prop-type,
html[data-theme="dark"] .swagger-ui .property.primitive,
html[data-theme="dark"] .swagger-ui section.models h4,
html[data-theme="dark"] .swagger-ui section.models .model-title,
html[data-theme="dark"] .swagger-ui .model,
html[data-theme="dark"] .swagger-ui .model-title,
html[data-theme="dark"] .swagger-ui small.version-stamp,
html[data-theme="dark"] .swagger-ui .scheme-container .schemes > label,
html[data-theme="dark"] .swagger-ui .dialog-ux .modal-ux-header h3,
html[data-theme="dark"] .swagger-ui .dialog-ux .modal-ux-content p,
html[data-theme="dark"] .swagger-ui .dialog-ux .modal-ux-content h4,
html[data-theme="dark"] .swagger-ui .dialog-ux .modal-ux-content label,
html[data-theme="dark"] .swagger-ui .responses-inner h4,
html[data-theme="dark"] .swagger-ui .responses-inner h5,
html[data-theme="dark"] .swagger-ui .opblock-section-header h4,
html[data-theme="dark"] .swagger-ui label {
  color: #d4d4d8 !important;
}

html[data-theme="dark"] .swagger-ui .scheme-container { background: #1b1b1f; box-shadow: 0 1px 2px 0 rgba(0,0,0,.4); }
html[data-theme="dark"] .swagger-ui .opblock-section-header { background: rgba(255,255,255,0.05); }

html[data-theme="dark"] .swagger-ui .opblock.opblock-get { background: rgba(97,175,254,.08); border-color: #61affe; }
html[data-theme="dark"] .swagger-ui .opblock.opblock-post { background: rgba(73,204,144,.08); border-color: #49cc90; }
html[data-theme="dark"] .swagger-ui .opblock.opblock-put { background: rgba(252,161,48,.08); border-color: #fca130; }
html[data-theme="dark"] .swagger-ui .opblock.opblock-delete { background: rgba(249,62,62,.08); border-color: #f93e3e; }
html[data-theme="dark"] .swagger-ui .opblock.opblock-patch { background: rgba(80,227,194,.08); border-color: #50e3c2; }
html[data-theme="dark"] .swagger-ui .opblock .opblock-summary { border-color: inherit; }
html[data-theme="dark"] .swagger-ui .opblock-body pre.microlight { background: #101012 !important; }
html[data-theme="dark"] .swagger-ui .opblock-body { background: #1b1b1f; }

html[data-theme="dark"] .swagger-ui section.models { border-color: #333; }
html[data-theme="dark"] .swagger-ui section.models.is-open h4 { border-color: #333; }
html[data-theme="dark"] .swagger-ui .model-box { background: rgba(255,255,255,0.05); }
html[data-theme="dark"] .swagger-ui .model-toggle:after { filter: invert(1); }

html[data-theme="dark"] .swagger-ui input[type=text],
html[data-theme="dark"] .swagger-ui input[type=password],
html[data-theme="dark"] .swagger-ui input[type=search],
html[data-theme="dark"] .swagger-ui input[type=email],
html[data-theme="dark"] .swagger-ui textarea,
html[data-theme="dark"] .swagger-ui select {
  background: #101012; color: #d4d4d8; border-color: #444;
}

html[data-theme="dark"] .swagger-ui .btn { color: #d4d4d8; border-color: #555; background: transparent; }
html[data-theme="dark"] .swagger-ui .btn.authorize { color: #49cc90; border-color: #49cc90; }
html[data-theme="dark"] .swagger-ui .btn.authorize svg { fill: #49cc90; }
html[data-theme="dark"] .swagger-ui .btn.execute { background: #4990e2; color: #fff; border-color: #4990e2; }
html[data-theme="dark"] .swagger-ui .copy-to-clipboard { background: #444; }

html[data-theme="dark"] .swagger-ui .dialog-ux .modal-ux { background: #1b1b1f; border-color: #333; }
html[data-theme="dark"] .swagger-ui .dialog-ux .modal-ux-header { border-color: #333; }

html[data-theme="dark"] .swagger-ui .markdown code,
html[data-theme="dark"] .swagger-ui .renderedMarkdown code { background: rgba(255,255,255,0.1); color: #e4e4e7; }

#gmgt-theme-toggle {
  position: fixed; top: 10px; right: 14px; z-index: 10000;
  display: flex; gap: 2px; padding: 3px;
  background: #ffffff; border: 1px solid #d4d4d8; border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0,0,0,.15);
  font-family: sans-serif;
}
html[data-theme="dark"] #gmgt-theme-toggle {
  background: #101012; border-color: #333;
}
#gmgt-theme-toggle button {
  border: none; background: transparent; cursor: pointer;
  font-size: 13px; line-height: 1; padding: 6px 9px; border-radius: 5px;
  color: #52525b;
}
html[data-theme="dark"] #gmgt-theme-toggle button { color: #a1a1aa; }
#gmgt-theme-toggle button.active {
  background: #4990e2; color: #fff;
}
</style>
"""

_TOGGLE_SCRIPT = f"""
<script>
(function() {{
  var KEY = {_STORAGE_KEY!r};
  var MODES = ['light', 'dark', 'system'];
  var LABELS = {{ light: 'Light', dark: 'Dark', system: 'Auto' }};

  function systemPref() {{
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }}
  function apply(mode) {{
    var resolved = mode === 'system' ? systemPref() : mode;
    document.documentElement.setAttribute('data-theme', resolved);
    Array.prototype.forEach.call(document.querySelectorAll('#gmgt-theme-toggle button'), function(btn) {{
      btn.classList.toggle('active', btn.dataset.mode === mode);
    }});
  }}

  var container = document.createElement('div');
  container.id = 'gmgt-theme-toggle';
  MODES.forEach(function(mode) {{
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.mode = mode;
    btn.textContent = LABELS[mode];
    btn.title = mode === 'system' ? 'Match OS theme' : LABELS[mode] + ' theme';
    btn.addEventListener('click', function() {{
      localStorage.setItem(KEY, mode);
      apply(mode);
    }});
    container.appendChild(btn);
  }});
  document.body.appendChild(container);

  apply(localStorage.getItem(KEY) || 'system');

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function() {{
    if ((localStorage.getItem(KEY) || 'system') === 'system') apply('system');
  }});
}})();
</script>
"""


def themed_swagger_ui_html(**kwargs) -> HTMLResponse:
    """Drop-in replacement for get_swagger_ui_html() with theme support layered on top."""
    response = get_swagger_ui_html(**kwargs)
    html = response.body.decode("utf-8")
    html = html.replace("<head>", "<head>" + _THEME_INIT_SCRIPT, 1)
    html = html.replace("</head>", _DARK_CSS + "</head>", 1)
    html = html.replace("</body>", _TOGGLE_SCRIPT + "</body>", 1)
    return HTMLResponse(html)
