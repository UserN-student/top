#!/usr/bin/env node
/**
 * build.js — сборщик сайта конспектов.
 * Не требует никакой структуры: сам находит .md файлы, сам определяет категории.
 * Категории (все варианты НЕОБЯЗАТЕЛЬНЫ, по порядку приоритета):
 *   1. frontmatter:  category: Базы данных
 *   2. подпапка:     notes/Базы данных/тема.md
 *   3. префикс имени: "Базы данных - тема.md"
 *   4. иначе:        "Конспекты"
 */

const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

const ROOT = path.resolve(__dirname, '..');

const CANDIDATE_DIRS = ['notes', 'content', 'md', 'docs', 'src', 'conspects', 'конспекты'];

const EXCLUDE_DIRS = new Set(['node_modules', '.git', '.github', '.vscode', '.idea', 'dist', 'build', 'out', 'scripts', 'public', 'vendor']);
const EXCLUDE_FILES = new Set(['readme.md', 'license.md', 'changelog.md', 'contributing.md', 'code_of_conduct.md', 'security.md', '_sidebar.md', '_footer.md', 'index.md']);

/* Весь список группы — для статистики посещаемости */
const STUDENTS = [
    'Левенцов Никита Сергеевич',
    'Мисюрев Сергей Игоревич',
    'Попов Андрей Сергеевич',
    'Перов Дмитрий Павлович',
    'Клеймёнов Александр Вячеславович',
    'Попов Александр Владимирович',
    'Нефедов Иван Сергеевич',
    'Климов Илья Владимирович',
    'Подугольников Антон Сергеевич',
    'Хлупин Владислав Евгеньевич',
    'Воротников Макар Владимирович',
];

/* ================= УТИЛИТЫ ================= */

/** "Я"/"я" (отдельным словом) → "Никита" */
function replacePronouns(text) {
    const before = String.raw`(^|[\s\n\r.,!?;:—–\-"«»""''()\[\]{}<>/\\|@#%^&*+=~` + '`' + String.raw`])`;
    const after = String.raw`([\s\n\r.,!?;:—–\-"«»""''()\[\]{}<>/\\|@#%^&*+=~` + '`' + String.raw`]|$)`;
    return text.replace(new RegExp(before + '[Яя]' + after, 'g'), (m, b, a) => b + 'Никита' + a);
}

/** Список присутствующих из "> Присутствуют: ..." или "> Фамилия Имя, ..." в начале файла */
function extractAttendees(content) {
    const lines = content.split('\n');
    const out = [];
    for (let i = 0; i < Math.min(lines.length, 15); i++) {
        const line = lines[i].trim();
        let m = line.match(/^>\s*Присутств(?:уют|ующие)?\s*:\s*(.+)$/i);
        if (m) {
            out.push(...m[1].split(/[,;]/).map(s => s.trim()).filter(Boolean));
            continue;
        }
        m = line.match(/^>\s*(.+)$/);
        if (m && i < 5) {
            const names = m[1].split(/[,;]/).map(s => s.trim()).filter(Boolean);
            const valid = names.filter(n => n.split(/\s+/).length >= 2 && n.split(/\s+/).every(w => /^[А-ЯЁA-Z]/.test(w)));
            if (valid.length >= 2) out.push(...valid);
        }
    }
    return [...new Set(out)];
}

function parseFrontmatter(content) {
    const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!m) return { meta: {}, content };
    const meta = {};
    m[1].split('\n').forEach(line => {
        const kv = line.match(/^([\w-]+):\s*(.+)$/);
        if (kv) meta[kv[1].trim()] = kv[2].trim();
    });
    return { meta, content: m[2] };
}

function slugify(text) {
    return text.toLowerCase()
        .replace(/[^\wа-яё\s-]/gi, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 60) || 'section';
}

/* ================= ПОИСК ФАЙЛОВ ================= */

function collectMd(dir, base, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (EXCLUDE_DIRS.has(entry.name)) continue;
            collectMd(path.join(dir, entry.name), base, out);
        } else if (entry.isFile()
            && entry.name.toLowerCase().endsWith('.md')
            && !EXCLUDE_FILES.has(entry.name.toLowerCase())) {
            const abs = path.join(dir, entry.name);
            out.push({ abs, rel: path.relative(base, abs) });
        }
    }
    return out;
}

function findNotes() {
    for (const cand of CANDIDATE_DIRS) {
        const dir = path.join(ROOT, cand);
        if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
            const files = collectMd(dir, dir);
            if (files.length) return { dir, files };
        }
    }
    const files = collectMd(ROOT, ROOT);   // фолбэк: весь репозиторий
    return files.length ? { dir: ROOT, files } : null;
}

/* ================= МЕТАДАННЫЕ СТРАНИЦЫ ================= */

function resolveCategory(meta, rel) {
    if (meta.category) return meta.category;
    const relDir = path.dirname(rel);
    if (relDir && relDir !== '.') return relDir.split(path.sep)[0];
    const base = path.basename(rel, '.md');
    const m = base.match(/^(.+?)\s*[-–—]\s*\S/);
    if (m) {
        const prefix = m[1].trim();
        if (!/^\d{4}[-._]/.test(prefix) && !/^\d{1,2}\.\d{1,2}\.\d{4}/.test(prefix)) return prefix;
    }
    return 'Конспекты';
}

function resolveTitle(meta, content, rel, category) {
    if (meta.title) return meta.title;
    const h1 = content.match(/^#\s+(.+)$/m);
    if (h1) return h1[1].trim();
    let base = path.basename(rel, '.md');
    base = base
        .replace(/^\d{4}-\d{2}-\d{2}[-_]*/, '')
        .replace(/^\d{1,2}\.\d{1,2}\.\d{4}[-_]*/, '')
        .replace(new RegExp('^' + category.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[-–—]\\s*', 'i'), '');
    base = base.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!base) return 'Без названия';
    return base.charAt(0).toUpperCase() + base.slice(1);
}

function resolveDate(meta, content, rel) {
    if (meta.date) {
        const d = new Date(meta.date);
        if (!isNaN(d.getTime())) return d.toLocaleDateString('ru-RU');
    }
    const base = path.basename(rel, '.md');
    let m = base.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}.${m[2]}.${m[1]}`;
    m = base.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    if (m) return `${m[1].padStart(2, '0')}.${m[2].padStart(2, '0')}.${m[3]}`;
    m = content.match(/^>\s*(\d{1,2}\.\d{1,2}\.\d{4})/m);
    if (m) return m[1];
    return '';
}

function addHeadingIds(html) {
    return html.replace(/<(h[23])([^>]*)>([^<]+)<\/\1>/gi, (m, tag, attrs, text) => {
        if (/id=/.test(attrs)) return m;
        return `<${tag}${attrs} id="${slugify(text.trim())}">${text}</${tag}>`;
    });
}

function extractToc(html) {
    const toc = [];
    const re = /<(h[23])[^>]*>([^<]+)<\/\1>/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
        toc.push({ level: parseInt(m[1][1], 10), text: m[2].trim(), id: slugify(m[2].trim()) });
    }
    return toc;
}

/* ================= ОБРАБОТКА ================= */

function processFile(file, usedIds) {
    const raw = fs.readFileSync(file.abs, 'utf-8');
    const { meta, content: body } = parseFrontmatter(raw);

    const students = extractAttendees(body);
    const processed = replacePronouns(body);

    const category = resolveCategory(meta, file.rel);
    const title = resolveTitle(meta, processed, file.rel, category);
    const date = resolveDate(meta, raw, file.rel);

    marked.setOptions({ gfm: true, breaks: false });
    let html = addHeadingIds(marked.parse(processed));
    const toc = extractToc(html);

    let id = slugify(category + ' ' + title);
    if (usedIds.has(id)) {
        let n = 2;
        while (usedIds.has(id + '-' + n)) n++;
        id = id + '-' + n;
    }
    usedIds.add(id);

    return { id, title, category, date, content: html, toc, students };
}

function buildAttendance(pages) {
    const map = new Map(STUDENTS.map(s => [s, 0]));
    pages.forEach(page => page.students.forEach(name => {
        const nParts = name.toLowerCase().split(/\s+/);
        const found = STUDENTS.find(s => {
            const sParts = s.toLowerCase().split(/\s+/);
            return sParts.some(p => nParts.includes(p));
        });
        const key = found || name;
        map.set(key, (map.get(key) || 0) + 1);
    }));
    return {
        students: [...map.entries()]
            .map(([name, attended]) => ({ name, attended }))
            .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
        totalLessons: pages.length,
    };
}

/* ================= ВШИВАНИЕ ДАННЫХ В index.html ================= */

function patchIndexHtml(siteData, attendanceData) {
    let file = path.join(ROOT, 'index.html');
    if (!fs.existsSync(file)) {
        const alt = fs.readdirSync(ROOT).find(f => f.toLowerCase().endsWith('.html'));
        if (!alt) return null;
        file = path.join(ROOT, alt);
    }
    let html = fs.readFileSync(file, 'utf-8');
    const orig = html;
    html = html.replace(/^([ \t]*)window\.siteData\s*=.*$/m,
        (m, sp) => sp + 'window.siteData = ' + JSON.stringify(siteData) + ';');
    html = html.replace(/^([ \t]*)window\.attendanceData\s*=.*$/m,
        (m, sp) => sp + 'window.attendanceData = ' + JSON.stringify(attendanceData) + ';');
    if (html !== orig) {
        fs.writeFileSync(file, html, 'utf-8');
        return path.relative(ROOT, file);
    }
    return null;
}

/* ================= MAIN ================= */

function main() {
    console.log('🔨 Начинаю сборку конспектов...\n');

    const found = findNotes();
    if (!found) {
        console.warn('⚠️  Markdown-конспекты не найдены.');
        console.warn('   Проверены папки: ' + CANDIDATE_DIRS.join(', ') + ' и корень репозитория.');
        console.warn('   Ничего не меняю, оставляю существующие данные как есть.');
        console.warn('   Чтобы добавить конспекты — просто положи .md файлы в папку notes/ в корне.');
        console.log('\n✨ Сборка завершена (без изменений).\n');
        return; // exit 0 — CI не падает
    }

    console.log(`📂 Папка с конспектами: ${path.relative(ROOT, found.dir) || '(корень репозитория)'}`);
    console.log(`📄 Найдено файлов: ${found.files.length}\n`);

    const usedIds = new Set();
    const pages = [];
    let errors = 0;

    for (const file of found.files) {
        try {
            const page = processFile(file, usedIds);
            pages.push(page);
            const extra = page.students.length ? `  (присутствуют: ${page.students.length})` : '';
            console.log(`  ✓ ${file.rel} → [${page.category}] ${page.title}${extra}`);
        } catch (err) {
            errors++;
            console.error(`  ✗ ${file.rel}: ${err.message}`);
        }
    }

    console.log(`\n✅ Обработано: ${pages.length}, ошибок: ${errors}\n`);

    // Группировка по категориям + сортировка по дате (новые сверху)
    const cats = new Map();
    pages.forEach(p => {
        if (!cats.has(p.category)) cats.set(p.category, []);
        cats.get(p.category).push(p);
    });
    cats.forEach(list => list.sort((a, b) => {
        const pa = a.date ? a.date.split('.').reverse().join('') : '0';
        const pb = b.date ? b.date.split('.').reverse().join('') : '0';
        return pb.localeCompare(pa);
    }));

    const siteData = {
        categories: [...cats.entries()]
            .sort(([a], [b]) => a.localeCompare(b, 'ru'))
            .map(([title, list]) => ({
                title,
                pages: list.map(p => ({
                    id: p.id, title: p.title, date: p.date,
                    content: p.content, toc: p.toc, students: p.students,
                })),
            })),
    };
    const attendanceData = buildAttendance(pages);

    fs.writeFileSync(path.join(ROOT, 'siteData.json'), JSON.stringify(siteData, null, 2), 'utf-8');
    fs.writeFileSync(path.join(ROOT, 'attendance.json'), JSON.stringify(attendanceData, null, 2), 'utf-8');

    const patched = patchIndexHtml(siteData, attendanceData);

    console.log('📦 Результаты:');
    console.log(`  → siteData.json     (${siteData.categories.length} катег., ${pages.length} стр.)`);
    console.log(`  → attendance.json   (${attendanceData.students.length} студ., ${attendanceData.totalLessons} зан.)`);
    console.log(patched ? `  → ${patched} (данные вшиты)` : '  → index.html не найден/не изменён (данные будут взяты из JSON)');

    const top = [...attendanceData.students].sort((a, b) => b.attended - a.attended).slice(0, 3);
    if (top.length && attendanceData.totalLessons) {
        console.log('\n🏆 Топ посещаемости:');
        top.forEach((s, i) => {
            const pct = Math.round(s.attended / attendanceData.totalLessons * 100);
            console.log(`  ${i + 1}. ${s.name}: ${s.attended}/${attendanceData.totalLessons} (${pct}%)`);
        });
    }
    console.log('\n✨ Готово!\n');
}

main();
