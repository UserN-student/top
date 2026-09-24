#!/usr/bin/env node
/**
 * build.js — сборщик сайта конспектов.
 * Ищет template.html, вшивает данные и кладёт результат в dist/index.html
 */

const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

// Где искать исходники .md (проверяет по очереди)
const CANDIDATE_DIRS = ['docs', 'notes', 'content', 'md', 'src', 'conspects', 'конспекты'];

// Что игнорировать при поиске
const EXCLUDE_DIRS = new Set([
    'node_modules', '.git', '.github', '.vscode', '.idea',
    'dist', 'build', 'out', 'scripts', 'public', 'vendor'
]);
const EXCLUDE_FILES = new Set([
    'readme.md', 'license.md', 'changelog.md', 'contributing.md',
    'code_of_conduct.md', 'security.md', '_sidebar.md', '_footer.md', 'index.md'
]);

/* ================= СПИСОК ГРУППЫ 9/4-РПО-23/1 ================= */
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

/* ================= СЛОВАРЬ СОКРАЩЕНИЙ ================= */
/**
 * Ключ — сокращение/прозвище в нижнем регистре.
 * Значение — полное ФИО из списка STUDENTS.
 * У одного человека может быть много сокращений.
 */
const NICKNAMES = {
    // Левенцов Никита Сергеевич
    'я': 'Левенцов Никита Сергеевич',
    'никита': 'Левенцов Никита Сергеевич',
    'никитос': 'Левенцов Никита Сергеевич',
    'ник': 'Левенцов Никита Сергеевич',
    'левенцов': 'Левенцов Никита Сергеевич',

    // Мисюрев Сергей Игоревич
    'серёга': 'Мисюрев Сергей Игоревич',
    'сергей': 'Мисюрев Сергей Игоревич',
    'серёж': 'Мисюрев Сергей Игоревич',
    'мисюрев': 'Мисюрев Сергей Игоревич',

    // Попов Андрей Сергеевич
    'андрей': 'Попов Андрей Сергеевич',
    'андрюха': 'Попов Андрей Сергеевич',
    'попов андрей': 'Попов Андрей Сергеевич',

    // Перов Дмитрий Павлович
    'дима': 'Перов Дмитрий Павлович',
    'димон': 'Перов Дмитрий Павлович',
    'дмитрий': 'Перов Дмитрий Павлович',
    'перов': 'Перов Дмитрий Павлович',

    // Клеймёнов Александр Вячеславович
    'саша к': 'Клеймёнов Александр Вячеславович',
    'сашка к': 'Клеймёнов Александр Вячеславович',
    'клеймёнов': 'Клеймёнов Александр Вячеславович',
    'клейменов': 'Клеймёнов Александр Вячеславович',
    'клём': 'Клеймёнов Александр Вячеславович',
    'александр вячеславович': 'Клеймёнов Александр Вячеславович',

    // Попов Александр Владимирович
    'саша п': 'Попов Александр Владимирович',
    'сашка п': 'Попов Александр Владимирович',
    'попов александр': 'Попов Александр Владимирович',
    'александр владимирович': 'Попов Александр Владимирович',

    // Нефедов Иван Сергеевич
    'ваня': 'Нефедов Иван Сергеевич',
    'ванёк': 'Нефедов Иван Сергеевич',
    'иван': 'Нефедов Иван Сергеевич',
    'нефедов': 'Нефедов Иван Сергеевич',

    // Климов Илья Владимирович
    'илья': 'Климов Илья Владимирович',
    'илюха': 'Климов Илья Владимирович',
    'илюш': 'Климов Илья Владимирович',
    'климов': 'Климов Илья Владимирович',

    // Подугольников Антон Сергеевич
    'антон': 'Подугольников Антон Сергеевич',
    'тоха': 'Подугольников Антон Сергеевич',
    'толян': 'Подугольников Антон Сергеевич',
    'подугольников': 'Подугольников Антон Сергеевич',

    // Хлупин Владислав Евгеньевич
    'влад': 'Хлупин Владислав Евгеньевич',
    'владос': 'Хлупин Владислав Евгеньевич',
    'владислав': 'Хлупин Владислав Евгеньевич',
    'хлупин': 'Хлупин Владислав Евгеньевич',

    // Воротников Макар Владимирович
    'макар': 'Воротников Макар Владимирович',
    'макарыч': 'Воротников Макар Владимирович',
    'воротников': 'Воротников Макар Владимирович',
};

/* ================= УТИЛИТЫ ================= */

/** "Я"/"я" (отдельным словом) → "Никита" (для текста конспекта) */
function replacePronouns(text) {
    const before = String.raw`(^|[\s\n\r.,!?;:—–\-"«»""''()\[\]{}<>/\\|@#%^&*+=~` + '`' + String.raw`])`;
    const after = String.raw`([\s\n\r.,!?;:—–\-"«»""''()\[\]{}<>/\\|@#%^&*+=~` + '`' + String.raw`]|$)`;
    return text.replace(new RegExp(before + '[Яя]' + after, 'g'), (m, b, a) => b + 'Никита' + a);
}

/**
 * Извлекает список присутствующих из цитаты в начале файла.
 * Форматы:
 *   > Присутствуют: Иванов, Петров, Я
 *   > Иванов Иван, Петров Пётр, Я
 */
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
            // Берём если похоже на список имён (есть запятые или ≥2 слов с заглавной)
            const valid = names.filter(n => {
                const words = n.split(/\s+/);
                return words.length >= 2 && words.every(w => /^[А-ЯЁA-Z]/.test(w));
            });
            if (valid.length >= 2) out.push(...valid);
            // Также берём одиночные слова/сокращения типа "Я", "Дима", "Илюха"
            const singles = names.filter(n => /^[А-ЯЁа-яёA-Za-z]+$/.test(n) && n.length >= 1);
            if (singles.length >= 2 && valid.length === 0) out.push(...singles);
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
    if (!fs.existsSync(dir)) return out;
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
    // Фолбэк: весь репозиторий
    const files = collectMd(ROOT, ROOT);
    return files.length ? { dir: ROOT, files } : null;
}

/* ================= МЕТАДАННЫЕ ================= */

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

    // Извлекаем присутствующих ДО замены местоимений (чтобы "я" в списке тоже распозналось)
    const students = extractAttendees(body);

    // Заменяем "Я/я" → "Никита" в основном тексте
    const processed = replacePronouns(body);
    // Удаляем первый H1 чтобы не дублировался с тем, что вставит шаблон
    const processedNoH1 = processed.replace(/^#\s+.+$/m, '').trim();

    const category = resolveCategory(meta, file.rel);
    const title = resolveTitle(meta, processedNoH1, file.rel, category);
    const date = resolveDate(meta, raw, file.rel);

    marked.setOptions({ gfm: true, breaks: false });
    let html = addHeadingIds(marked.parse(processedNoH1));
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

/**
 * Ищет студента из списка по имени из конспекта.
 * 1. Сначала проверяет словарь сокращений (точное совпадение).
 * 2. Потом ищет по совпадению слов (фамилия/имя/отчество).
 */
function matchStudent(name) {
    const clean = name.trim().toLowerCase();
    
    // 1. Точное совпадение в словаре сокращений
    if (NICKNAMES[clean]) {
        return NICKNAMES[clean];
    }
    
    // 2. Частичное совпадение по словам
    const nParts = clean.split(/\s+/).filter(Boolean);
    let best = null;
    let bestScore = 0;
    
    for (const s of STUDENTS) {
        const sParts = s.toLowerCase().split(/\s+/);
        const score = nParts.filter(p => sParts.includes(p)).length;
        if (score > bestScore) {
            bestScore = score;
            best = s;
        }
    }
    
    return bestScore >= 1 ? best : null;
}

function buildAttendance(pages) {
    const map = new Map(STUDENTS.map(s => [s, 0]));
    pages.forEach(page => page.students.forEach(name => {
        const found = matchStudent(name);
        const key = found || name.trim();   // кого нет в списке — пишем как есть
        map.set(key, (map.get(key) || 0) + 1);
    }));
    return {
        students: [...map.entries()]
            .map(([name, attended]) => ({ name, attended }))
            .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
        totalLessons: pages.length,
    };
}

/* ================= СБОРКА В DIST ================= */

function buildDist(siteData, attendanceData) {
    if (!fs.existsSync(DIST)) fs.mkdirSync(DIST, { recursive: true });

    // Ищем template.html или index.html
    let srcHtml = path.join(ROOT, 'template.html');
    if (!fs.existsSync(srcHtml)) {
        srcHtml = path.join(ROOT, 'index.html');
    }

    if (!fs.existsSync(srcHtml)) {
        console.error('❌ Не найден ни template.html, ни index.html в корне!');
        process.exit(1);
    }

    let html = fs.readFileSync(srcHtml, 'utf-8');
    
    // Вшиваем данные
    html = html.replace(/^([ \t]*)window\.siteData\s*=.*$/m, 
        (m, sp) => sp + 'window.siteData = ' + JSON.stringify(siteData) + ';');
    html = html.replace(/^([ \t]*)window\.attendanceData\s*=.*$/m, 
        (m, sp) => sp + 'window.attendanceData = ' + JSON.stringify(attendanceData) + ';');

    // Пишем итоговый index.html в dist
    fs.writeFileSync(path.join(DIST, 'index.html'), html, 'utf-8');

    // Дополнительно пишем JSON (на всякий случай)
    fs.writeFileSync(path.join(DIST, 'siteData.json'), JSON.stringify(siteData, null, 2), 'utf-8');
    fs.writeFileSync(path.join(DIST, 'attendance.json'), JSON.stringify(attendanceData, null, 2), 'utf-8');
}

/* ================= MAIN ================= */

function main() {
    console.log('🔨 Начинаю сборку конспектов...\n');

    const found = findNotes();
    
    let pages = [];
    let siteData = { categories: [] };
    let attendanceData = { students: [], totalLessons: 0 };

    if (!found) {
        console.warn('⚠️  Markdown-конспекты не найдены.');
        console.warn('   Проверены папки: ' + CANDIDATE_DIRS.join(', ') + ' и корень.');
        
        // Пытаемся взять старые данные из шаблона
        let srcHtml = path.join(ROOT, 'template.html');
        if (!fs.existsSync(srcHtml)) srcHtml = path.join(ROOT, 'index.html');
        
        if (fs.existsSync(srcHtml)) {
             const html = fs.readFileSync(srcHtml, 'utf-8');
             const m1 = html.match(/window\.siteData\s*=\s*({[\s\S]*?});/);
             const m2 = html.match(/window\.attendanceData\s*=\s*({[\s\S]*?});/);
             if (m1) try { siteData = JSON.parse(m1[1]); } catch(e){}
             if (m2) try { attendanceData = JSON.parse(m2[1]); } catch(e){}
             
             if (siteData.categories.length > 0) {
                 console.log('   ✅ Найдены старые данные в шаблоне, использую их.');
             }
        }
    } else {
        console.log(` Папка с конспектами: ${path.relative(ROOT, found.dir) || '(корень)'}`);
        console.log(`📄 Найдено файлов: ${found.files.length}\n`);

        const usedIds = new Set();
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

        // Группировка
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

        siteData = {
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
        attendanceData = buildAttendance(pages);
    }

    // Собираем dist
    try {
        buildDist(siteData, attendanceData);
    } catch (e) {
        console.error('❌ Ошибка при создании dist:', e);
        process.exit(1);
    }

    console.log('📦 Результаты в папке dist/:');
    console.log(`  → index.html      (данные вшиты)`);
    console.log(`  → siteData.json   (${siteData.categories.length} катег., ${pages.length} стр.)`);
    console.log(`  → attendance.json (${attendanceData.students.length} студ., ${attendanceData.totalLessons} зан.)`);

    const top = [...attendanceData.students].sort((a, b) => b.attended - a.attended).slice(0, 3);
    if (top.length && attendanceData.totalLessons) {
        console.log('\n🏆 Топ посещаемости:');
        top.forEach((s, i) => {
            const pct = Math.round(s.attended / attendanceData.totalLessons * 100);
            console.log(`  ${i + 1}. ${s.name}: ${s.attended}/${attendanceData.totalLessons} (${pct}%)`);
        });
    }
    console.log('\n✨ Готово! Папка dist/ готова к деплою.\n');
}

main();
