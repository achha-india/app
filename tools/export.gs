/**
 * Разговорник для Индии — выгрузка таблицы «Фразы» в JSON для приложения.
 *
 * Как установить (один раз):
 *   1. В таблице: Расширения → Apps Script.
 *   2. Удалить всё в файле Code.gs и вставить этот код. Сохранить.
 *   3. Вернуться в таблицу и обновить страницу: появится меню «Разговорник».
 *   4. При первом запуске Google попросит разрешение на доступ к таблице и Drive.
 *
 * Как пользоваться:
 *   Разговорник → Выгрузить JSON.
 *   Скрипт проверит таблицу, сохранит phrases.json в ваш Google Drive
 *   (перезаписывая прошлую версию) и покажет ссылку и найденные ошибки.
 */

var SHEET_NAME = 'Фразы';
var FILE_NAME = 'phrases.json';

// Заголовки таблицы → ключи в JSON
var COLUMNS = {
  'ID': 'id',
  'Этап': 'stage',
  'Ситуация': 'situation',
  'Порядок': 'order',
  'Роль': 'role',
  'Ответ на': 'replyTo',
  'Английский': 'en',
  'Чтение': 'read',
  'Перевод': 'ru',
  'Пометка': 'note',
  'Уровень': 'level',
  'Голос': 'voice',
  'Статус': 'status'
};

var ROLES = { 'Турист': 'tourist', 'Индиец': 'local' };
var REQUIRED = ['id', 'stage', 'situation', 'order', 'role', 'en', 'read', 'ru'];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Разговорник')
    .addItem('Выгрузить JSON', 'exportJson')
    .addItem('Только проверить таблицу', 'checkOnly')
    .addToUi();
}

function exportJson() {
  var result = buildFromSheet_();
  var ui = SpreadsheetApp.getUi();
  if (result.errors.length) {
    ui.alert('JSON не сохранён, исправьте ошибки:\n\n' + result.errors.join('\n'));
    return;
  }
  var text = JSON.stringify(result.data, null, 2);
  var files = DriveApp.getFilesByName(FILE_NAME);
  var file;
  if (files.hasNext()) {
    file = files.next();
    file.setContent(text);
  } else {
    file = DriveApp.createFile(FILE_NAME, text, 'application/json');
  }
  var msg = 'Готово: ' + result.data.count + ' реплик.\n' + file.getUrl();
  if (result.warnings.length) msg += '\n\nПредупреждения:\n' + result.warnings.join('\n');
  ui.alert(msg);
}

function checkOnly() {
  var r = buildFromSheet_();
  var parts = [];
  parts.push(r.errors.length ? 'Ошибки:\n' + r.errors.join('\n') : 'Ошибок нет.');
  if (r.warnings.length) parts.push('Предупреждения:\n' + r.warnings.join('\n'));
  SpreadsheetApp.getUi().alert(parts.join('\n\n'));
}

function buildFromSheet_() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
  if (!sheet) return { errors: ['Нет листа «' + SHEET_NAME + '».'], warnings: [], data: null };
  return buildPhrasebook(sheet.getDataRange().getDisplayValues(), new Date().toISOString());
}

/**
 * Чистая функция: таблица (массив строк) → { data, errors, warnings }.
 * Не зависит от Google, поэтому её же можно запускать локально для проверки.
 */
function buildPhrasebook(values, generatedAt) {
  var errors = [], warnings = [];
  var header = values[0].map(function (h) { return String(h).trim(); });
  var idx = {};
  Object.keys(COLUMNS).forEach(function (title) {
    var i = header.indexOf(title);
    if (i < 0) errors.push('Нет столбца «' + title + '».');
    idx[COLUMNS[title]] = i;
  });
  if (errors.length) return { data: null, errors: errors, warnings: warnings };

  var lines = [], seen = {};
  for (var r = 1; r < values.length; r++) {
    var row = values[r], rowNo = r + 1;
    if (row.join('').trim() === '') continue; // пустая строка
    var line = {};
    Object.keys(idx).forEach(function (key) {
      line[key] = String(row[idx[key]] == null ? '' : row[idx[key]]).trim();
    });
    REQUIRED.forEach(function (key) {
      if (!line[key]) errors.push('Строка ' + rowNo + ': пусто в «' + titleOf_(key) + '».');
    });
    if (line.id) {
      if (seen[line.id]) errors.push('Строка ' + rowNo + ': ID ' + line.id + ' повторяется (уже в строке ' + seen[line.id] + ').');
      seen[line.id] = rowNo;
    }
    if (line.role && !ROLES[line.role]) errors.push('Строка ' + rowNo + ': роль «' + line.role + '», нужно «Турист» или «Индиец».');
    line.role = ROLES[line.role] || line.role;
    var n = Number(line.order);
    if (line.order && !(n > 0 && Math.floor(n) === n)) errors.push('Строка ' + rowNo + ': «Порядок» должен быть целым числом.');
    line.order = n;
    line.rowNo = rowNo;
    lines.push(line);
  }

  lines.forEach(function (l) {
    if (l.replyTo && !seen[l.replyTo]) {
      errors.push('Строка ' + l.rowNo + ': «Ответ на» ссылается на ' + l.replyTo + ', такого ID нет.');
    }
  });

  // Этапы и ситуации — в порядке первого появления в таблице
  var stages = [], stageMap = {};
  lines.forEach(function (l) {
    if (!stageMap[l.stage]) {
      stageMap[l.stage] = { name: l.stage, situations: [], _sit: {} };
      stages.push(stageMap[l.stage]);
    }
    var st = stageMap[l.stage];
    if (!st._sit[l.situation]) {
      st._sit[l.situation] = { name: l.situation, lines: [] };
      st.situations.push(st._sit[l.situation]);
    }
    var out = {
      id: l.id, order: l.order, role: l.role, replyTo: l.replyTo || null,
      en: l.en, read: l.read, ru: l.ru, note: l.note || null,
      level: l.level || null, voice: l.voice || (l.role === 'local' ? 'en-IN' : 'en-US'),
      status: l.status || null
    };
    st._sit[l.situation].lines.push(out);
  });

  stages.forEach(function (st) {
    delete st._sit;
    st.situations.forEach(function (s) {
      s.lines.sort(function (a, b) { return a.order - b.order; });
      for (var i = 1; i < s.lines.length; i++) {
        if (s.lines[i].order === s.lines[i - 1].order) {
          warnings.push('«' + s.name + '»: два раза «Порядок» = ' + s.lines[i].order + '.');
        }
      }
    });
  });

  var drafts = lines.filter(function (l) { return l.status !== 'Проверено'; }).length;
  if (drafts) warnings.push('Не проверено носителем: ' + drafts + ' реплик.');

  return {
    data: { version: 1, generatedAt: generatedAt, count: lines.length, stages: stages },
    errors: errors,
    warnings: warnings
  };
}

function titleOf_(key) {
  for (var t in COLUMNS) if (COLUMNS[t] === key) return t;
  return key;
}

// Для локальной проверки в Node.js; в Apps Script эта строка ничего не делает.
if (typeof module !== 'undefined') module.exports = { buildPhrasebook: buildPhrasebook };

// ---------------------------------------------------------------------------
// Обратная связь из приложения: сообщения пишутся на лист «Отзывы».
// Личные данные не сохраняются: только дата, текст и раздел приложения.
//
// Как включить (один раз):
//   Apps Script → «Начать развертывание» (Deploy) → «Новое развертывание» →
//   тип «Веб-приложение» → «Запуск от имени»: Я, «У кого есть доступ»: Все →
//   «Начать развертывание». Скопируйте ссылку вида https://script.google.com/macros/s/.../exec
//   и вставьте её в приложение (FEEDBACK_URL).
// ---------------------------------------------------------------------------

var FEEDBACK_SHEET = 'Отзывы';
var FEEDBACK_MAX_PER_MIN = 30;

function doPost(e) {
  try {
    var data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var text = clean_(data.text, 1000);
    var context = clean_(data.context, 200);
    if (text.length < 3) return json_({ ok: false });

    // Защита от спама: не больше FEEDBACK_MAX_PER_MIN сообщений в минуту на всё приложение
    var cache = CacheService.getScriptCache();
    var key = 'fb-' + Math.floor(Date.now() / 60000);
    var n = Number(cache.get(key) || 0);
    if (n >= FEEDBACK_MAX_PER_MIN) return json_({ ok: false });
    cache.put(key, String(n + 1), 120);

    var lock = LockService.getScriptLock();
    lock.waitLock(5000);
    try {
      var ss = SpreadsheetApp.getActive() || SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID'));
      var sh = ss.getSheetByName(FEEDBACK_SHEET);
      if (!sh) {
        sh = ss.insertSheet(FEEDBACK_SHEET);
        sh.appendRow(['Дата', 'Сообщение', 'Раздел', 'Статус']);
        sh.setFrozenRows(1);
        sh.getRange('A1:D1').setFontWeight('bold');
        sh.setColumnWidth(2, 420);
      }
      sh.appendRow([new Date(), text, context, 'Новое']);
    } finally {
      lock.releaseLock();
    }
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false });
  }
}

function clean_(v, max) {
  var s = String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
  // Чтобы текст не превратился в формулу таблицы
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
