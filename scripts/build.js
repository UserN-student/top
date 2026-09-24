const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

// ============ КОНФИГУРАЦИЯ ============
const CONFIG = {
    notesDir: path.join(__dirname, 'notes'),          // папка с конспектами
    outputDir: __dirname,                               // куда писать JSON
    siteDataFile: 'siteData.json',
    attendanceFile: 'attendance.json',
    
    // Все студенты группы (захардкодь свой список)
    allStudents: [
        'Абрамов Андрей',
        'Белов Данил',
        'Васильев Кирилл',
        'Громов Артём',
        'Дмитриев Максим',
        'Егоров Илья',
        'Жуков Павел',
        'Зайцев Роман',
        'Иванов Сергей',
        'Козлов Никита',
        'Лебедев Денис',
        'Левенцов Никита',
        'Морозов Александр',
        'Новиков Дмитрий',
        'Орлов Владислав',
        'Петров Михаил',
        'Романов Егор',
        'Смирнов Тимур',
        'Тихонов Глеб',
        'Ушаков Ярослав',
        'Фёдоров Марк',
        'Харитонов Матвей',
        'Цветков Лев',
        'Чернов Платон',
        'Шевченко Даниил',
    ],
};

// ============ УТИЛИТЫ ============

/**
 * Заменяет "Я"/"я" (standalone) на "Никита"
 */
function replacePronouns(text) {
    const boundary = String.raw`(^|[\s\n\r.,!?;:—–\-"«»""''()\[\]{}<>/\\|@#%^&*+=~\`])`;
    const boundaryAfter = String.raw`([\s\n\r.,!?;:—–\-"«»""''()\[\]{}<>/\\|@#%^&*+=~\`]|$)`;
    const re = new RegExp(boundary + '[Яя]' + boundaryAfter, 'g');
    return text.replace(re, (match, before, after) => before + 'Никита' + after);
}

/**
 * Извлекает список присутствующих из markdown-цитаты в начале файла.
 * Ищет паттерн "> Присутствуют: ..." или "> ..." в первых строках.
 */
function extractAttendees(content) {
    const lines = content.split('\n');
    const attendees = [];
    
    for (let i = 0; i < Math.min(lines.length, 15); i++) {
        const line = lines[i].trim();
        
        // Паттерн 1: "> Присутствуют: Иванов, Петров, Сидоров"
        let match = line.match(/^>\s*Присутств(?:уют|ующие)?\s*:\s*(.+)$/i);
        if (match) {
            const names = match[1].split(/[,;]/).map(n => n.trim()).filter(Boolean);
            attendees.push(...names);
            continue;
        }
        
        // Паттерн 2: просто "> Иванов, Петров" (если это первая цитата)
        match = line.match(/^>\s*(.+)$/);
        if (match && i < 5) {
            const text = match[1].trim();
            // Проверяем что это похоже на список ФИО (содержит запятые и пробелы)
            if (text.includes(',') || text.split(/\s+/).length >= 3) {
                const names = text.split(/[,;]/).map(n => n.trim()).filter(Boolean);
                // Проверяем что имена выглядят как ФИО (минимум 2 слова с заглавной)
                const validNames = names.filter(n => {
                    const words = n.split(/\s+/);
                    return words.length >= 2 && words.every(w => /^[А-ЯЁA-Z]/.test(w));
                });
                if (validNames.length >= 2) {
                    attendees.push(...validNames);
                }
            }
        }
    }
    
    return [...new Set(attendees)]; // убираем дубликаты
}

/**
 * Извлекает заголовок H1 из markdown (если есть)
 */
function extractTitle(content) {
    const match = content.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : null;
}

/**
 * Извлекает дату из frontmatter или имени файла
 */
function extractDate(content, filename) {
    // Из frontmatter: date: 2024-01-15
    const fmMatch = content.match(/^---[\s\S]*?date:\s*(.+?)[\s\S]*?---/);
    if (fmMatch) {
        const d = new Date(fmMatch[1].trim());
        if (!isNaN(d.getTime())) {
            return d.toLocaleDateString('ru-RU');
        }
    }
    
    // Из имени файла: 2024-01-15-topic.md
    const fileMatch = filename.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (fileMatch) {
        const [, y, m, d] = fileMatch;
        return `${d}.${m}.${y}`;
    }
    
    // Из даты модификации файла
    return '';
}

/**
 * Парсит frontmatter (если есть)
 */
function parseFrontmatter(content) {
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) return { meta: {}, content };
    
    const metaStr = match[1];
    const body = match[2];
    const meta = {};
    
    metaStr.split('\n').forEach(line => {
        const m = line.match(/^(\w+):\s*(.+)$/);
        if (m) meta[m[1]] = m[2].trim();
    });
    
    return { meta, content: body };
}

/**
 * Генерирует slug из строки
 */
function slugify(text) {
    return text.toLowerCase()
        .replace(/[^\wа-яё\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 60) || 'section';
}

/**
 * Извлекает TOC из HTML (заголовки h2, h3)
 */
function extractToc(html) {
    const toc = [];
    const regex = /<(h[23])[^>]*>([^<]+)<\/\1>/gi;
    let match;
    
    while ((match = regex.exec(html)) !== null) {
        const level = parseInt(match[1][1]);
        const text = match[2].trim();
        const id = slugify(text);
        toc.push({ level, text, id });
    }
    
    return toc;
}

/**
 * Добавляет id к заголовкам в HTML
 */
function addHeadingIds(html) {
    return html.replace(/<(h[23])([^>]*)>([^<]+)<\/\1>/gi, (match, tag, attrs, text) => {
        const id = slugify(text.trim());
        return `<${tag}${attrs} id="${id}">${text}</${tag}>`;
    });
}

// ============ ОБРАБОТКА ФАЙЛОВ ============

/**
 * Рекурсивно читает все .md файлы
 */
function walkDir(dir, baseDir = dir) {
    const results = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
            results.push(...walkDir(fullPath, baseDir));
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
            const relativePath = path.relative(baseDir, fullPath);
            results.push({
                path: fullPath,
                relativePath,
                filename: entry.name,
                dir: path.dirname(relativePath),
            });
        }
    }
    
    return results;
}

/**
 * Обрабатывает один markdown-файл
 */
function processFile(fileInfo) {
    let raw = fs.readFileSync(fileInfo.path, 'utf-8');
    
    // Парсим frontmatter
    const { meta, content: afterFm } = parseFrontmatter(raw);
    
    // Извлекаем присутствующих ДО замены местоимений
    const attendees = extractAttendees(afterFm);
    
    // Заменяем "Я/я" на "Никита"
    const processed = replacePronouns(afterFm);
    
    // Извлекаем заголовок
    const title = meta.title || extractTitle(processed) || path.basename(fileInfo.filename, '.md').replace(/^\d{4}-\d{2}-\d{2}-/, '');
    
    // Дата
    const date = meta.date || extractDate(raw, fileInfo.filename);
    
    // Категория (из папки или frontmatter)
    const category = meta.category || fileInfo.dir.split(path.sep)[0] || 'Без категории';
    
    // Конвертируем в HTML
    marked.setOptions({
        gfm: true,
        breaks: false,
        headerIds: false,
    });
    
    let html = marked.parse(processed);
    
    // Добавляем id к заголовкам
    html = addHeadingIds(html);
    
    // Извлекаем TOC
    const toc = extractToc(html);
    
    // Генерируем ID страницы
    const pageId = slugify(category + ' ' + title);
    
    return {
        id: pageId,
        title,
        category,
        date,
        content: html,
        toc,
        students: attendees,
    };
}

// ============ СБОР СТАТИСТИКИ ============

/**
 * Подсчитывает посещаемость по всем конспектам
 */
function buildAttendanceData(pages, allStudents) {
    const studentMap = {};
    
    // Инициализируем всех студентов
    allStudents.forEach(name => {
        studentMap[name] = 0;
    });
    
    // Считаем посещения
    pages.forEach(page => {
        page.students.forEach(name => {
            // Ищем студента в списке (нечёткий матчинг по фамилии)
            const found = allStudents.find(s => {
                const sParts = s.toLowerCase().split(/\s+/);
                const nParts = name.toLowerCase().split(/\s+/);
                // Совпадение если есть общая фамилия или имя
                return sParts.some(p => nParts.includes(p)) || nParts.some(p => sParts.includes(p));
            });
            
            if (found) {
                studentMap[found]++;
            } else {
                // Студент не из списка — добавляем
                if (!studentMap[name]) studentMap[name] = 0;
                studentMap[name]++;
            }
        });
    });
    
    // Преобразуем в массив и сортируем
    const students = Object.entries(studentMap)
        .map(([name, attended]) => ({ name, attended }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    
    return {
        students,
        totalLessons: pages.length,
    };
}

// ============ ГЛАВНАЯ ФУНКЦИЯ ============

function build() {
    console.log('🔨 Начинаю сборку конспектов...\n');
    
    // Проверяем что папка notes существует
    if (!fs.existsSync(CONFIG.notesDir)) {
        console.error(`❌ Папка ${CONFIG.notesDir} не найдена!`);
        console.log('Создай структуру:');
        console.log('  notes/');
        console.log('    Предмет 1/');
        console.log('      2024-01-15-тема-1.md');
        console.log('      2024-01-20-тема-2.md');
        console.log('    Предмет 2/');
        console.log('      2024-02-01-тема-1.md');
        process.exit(1);
    }
    
    // Читаем все .md файлы
    const files = walkDir(CONFIG.notesDir);
    console.log(`📄 Найдено ${files.length} markdown-файлов\n`);
    
    if (files.length === 0) {
        console.warn('⚠️  Нет файлов для обработки');
        process.exit(0);
    }
    
    // Обрабатываем каждый файл
    const pages = [];
    let errors = 0;
    
    files.forEach(file => {
        try {
            const page = processFile(file);
            pages.push(page);
            console.log(`✓ ${file.relativePath}`);
            if (page.students.length > 0) {
                console.log(`  └─ Присутствуют: ${page.students.length} чел.`);
            }
        } catch (err) {
            console.error(`✗ ${file.relativePath}: ${err.message}`);
            errors++;
        }
    });
    
    console.log(`\n✅ Обработано: ${pages.length}, ошибок: ${errors}\n`);
    
    // Группируем по категориям
    const categoriesMap = {};
    pages.forEach(page => {
        if (!categoriesMap[page.category]) {
            categoriesMap[page.category] = [];
        }
        categoriesMap[page.category].push(page);
    });
    
    // Сортируем страницы внутри категорий по дате (новые сверху)
    Object.values(categoriesMap).forEach(catPages => {
        catPages.sort((a, b) => {
            const da = a.date.split('.').reverse().join('');
            const db = b.date.split('.').reverse().join('');
            return db.localeCompare(da);
        });
    });
    
    // Формируем siteData
    const siteData = {
        categories: Object.entries(categoriesMap)
            .sort(([a], [b]) => a.localeCompare(b, 'ru'))
            .map(([title, catPages]) => ({
                title,
                pages: catPages.map(p => ({
                    id: p.id,
                    title: p.title,
                    date: p.date,
                    content: p.content,
                    toc: p.toc,
                    students: p.students,
                })),
            })),
    };
    
    // Формируем attendanceData
    const attendanceData = buildAttendanceData(pages, CONFIG.allStudents);
    
    // Пишем файлы
    const siteDataPath = path.join(CONFIG.outputDir, CONFIG.siteDataFile);
    const attendancePath = path.join(CONFIG.outputDir, CONFIG.attendanceFile);
    
    fs.writeFileSync(siteDataPath, JSON.stringify(siteData, null, 2), 'utf-8');
    fs.writeFileSync(attendancePath, JSON.stringify(attendanceData, null, 2), 'utf-8');
    
    console.log('📦 Результаты:');
    console.log(`  → ${CONFIG.siteDataFile} (${siteData.categories.length} категорий, ${pages.length} страниц)`);
    console.log(`  → ${CONFIG.attendanceFile} (${attendanceData.students.length} студентов, ${attendanceData.totalLessons} занятий)`);
    console.log('\n✨ Готово!\n');
    
    // Статистика
    const topStudents = [...attendanceData.students]
        .sort((a, b) => b.attended - a.attended)
        .slice(0, 3);
    
    if (topStudents.length > 0) {
        console.log('🏆 Топ посещаемости:');
        topStudents.forEach((s, i) => {
            const pct = attendanceData.totalLessons > 0 
                ? Math.round(s.attended / attendanceData.totalLessons * 100) 
                : 0;
            console.log(`  ${i + 1}. ${s.name}: ${s.attended}/${attendanceData.totalLessons} (${pct}%)`);
        });
    }
}

// Запуск
build();
