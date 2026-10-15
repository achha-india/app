"""Собирает index.html для GitHub Pages из src/page.html.

src/page.html — содержимое страницы без <!doctype>/<head> (в таком виде её можно
публиковать и как превью). Сборка добавляет шапку документа, манифест, иконки
и регистрацию Service Worker для офлайн-режима.

Запуск: python3 tools/build.py
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
page = (ROOT / "src" / "page.html").read_text(encoding="utf-8")

# Убираем строки, которые уйдут в шапку документа
drop = ('<meta charset="utf-8">', '<meta name="claude:viewport-fit-sides"')
body = "\n".join(l for l in page.splitlines() if not l.strip().startswith(drop))

head = """<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="Разговорник для туристов в Индии: что сказать и что вам ответят. Работает без интернета.">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" type="image/png" sizes="32x32" href="icons/favicon-32.png">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Ачча!">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<style>
html { padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); }
body { margin: 0; }
img { max-width: 100%; }
</style>
"""

sw = """
<script>
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  });
}
</script>
"""

out = head + body.strip() + "\n" + sw
(ROOT / "index.html").write_text(out, encoding="utf-8")
print("index.html собран:", len(out), "символов")
