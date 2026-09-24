const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { marked } = require('marked');

const DOCS_DIR = path.join(__dirname, '..', 'docs');
const OUTPUT_DIR = path.join(__dirname, '..', 'dist');

// template.html может лежать в корне репозитория или рядом со скриптом
let TEMPLATE_PATH = path.join(__dirname, '..', 'template.html');
if (!fs.existsSync(TEMPLATE_PATH)) {
    TEMPLATE_PATH = path.join(__dirname, 'template.html');
}

if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const MONTHS_RU = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
                   'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

// Хардкод списка группы (11 человек): короткое имя из конспекта -> ФИО
const GROUP_ROSTER = [
    { short: 'Никита', full: 'Левенцов Никита Сергеевич' },
    { short: 'Дима',   full: 'Перов Дмитрий Павлович' },
    { short: 'Андрей', full: 'Попов Андрей Сергеевич' },
    { short: 'Саня П', full: 'Попов Александр Владимирович' },
    { short: 'Сергей', full: 'Мисюрев Сергей Игоревич' },
    { short: 'Саня К', full: 'Клеймёнов Александр Вячеславович' },
    { short: 'Макар',  full: 'Воротников Макар Владимирович' },
    { short: 'Иван',   full: 'Нефедов Иван Сергеевич' },
    { short: 'Илья',   full: 'Климов Илья Владимирович' },
    { short: 'Влад',   full: 'Хлупин Владислав Евгеньевич' },
    { short: 'Антон',  full: 'Подугольников Антон Сергеевич' }
];

function formatDateFromFilename(filename) {
    const match = filename.match(/^(\d{2})\.(\d{2})\.(\d{4})\.md$/);
    if (!match) return null;

    const day = parseInt(match[1], 10);
    const monthIdx = parseInt(match[2], 10) - 1;
    const year = match[3];

    if (monthIdx >= 0 && monthIdx < 12) {
        return `${day} ${MONTHS_RU[monthIdx]} ${year}`;
    }
    return null;
}

function parseDateForSort(filename) {
    const match = filename.match(/^(\d{2})\.(\d{2})\.(\d{4})\.md$/);
    if (!match) return null;
    const day = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1;
    const year = parseInt(match[3], 10);
    return new Date(year, month, day);
}

function parseStudents(markdown) {
    // Ищем строку "> Присутствуют: ..." или "> Присутствующие: ..."
    const match = markdown.match(/^>\s*Присутств(?:уют|ующие):\s*(.+)$/mi);
    if (!match) return [];

    return match[1]
        .split(',')
        .map(s => s.trim())
        .filter(s => s.length > 0);
}

function readDocsDir(dir) {
    const categories = [];

    if (!fs.existsSync(dir)) {
        return categories;
    }

    const items = fs.readdirSync(dir, { withFileTypes: true });

    items.forEach(item => {
        if (item.name.startsWith('.')) return;

        const fullPath = path.join(dir, item.name);

        if (item.isDirectory()) {
            const category = {
                id: item.name,
                title: item.name.charAt(0).toUpperCase() + item.name.slice(1).replace(/-/g, ' '),
                pages: []
            };

            const files = fs.readdirSync(fullPath).filter(f => f.endsWith('.md'));

            // Сортируем по дате (имя файла в формате дд.мм.гггг)
            files.sort((a, b) => {
                const dateA = parseDateForSort(a);
                const dateB = parseDateForSort(b);
                if (dateA && dateB) {
                    return dateA.getTime() - dateB.getTime();
                }
                return a.localeCompare(b);
            });

            files.forEach(file => {
                const filePath = path.join(fullPath, file);
                const content = fs.readFileSync(filePath, 'utf-8');
                const { content: markdown } = matter(content);

                // Название конспекта из первого H1
                const titleMatch = markdown.match(/^#\s+(.+)$/m);
                const title = titleMatch ? titleMatch[1].trim() : file.replace('.md', '');

                // Дата из имени файла
                const dateFormatted = formatDateFromFilename(file);

                // Список присутствующих из строки "> Присутствуют: ..."
                const students = parseStudents(markdown);

                // Вырезаем строку с присутствующими и дублирующий H1
                let cleanMarkdown = markdown;
                cleanMarkdown = cleanMarkdown.replace(/^>\s*Присутств(?:уют|ующие):.*$/mi, '');
                cleanMarkdown = cleanMarkdown.replace(/^#\s+.+$/m, '');
                cleanMarkdown = cleanMarkdown.trim();

                const htmlContent = marked(cleanMarkdown);

                const toc = [];
                const headingRegex = /^(#{2,3})\s+(.+)$/gm;
                let match;

                while ((match = headingRegex.exec(cleanMarkdown)) !== null) {
                    const level = match[1].length;
                    const text = match[2].trim();
                    const id = text.toLowerCase()
                        .replace(/[^\wа-яё\s-]/gi, '')
                        .replace(/\s+/g, '-')
                        .replace(/-+/g, '-');
                    toc.push({ id, text, level });
                }

                category.pages.push({
                    id: `${item.name}-${file.replace('.md', '')}`,
                    title,
                    date: dateFormatted,
                    category: category.id,
                    students,
                    content: htmlContent,
                    toc
                });
            });

            if (category.pages.length > 0) {
                categories.push(category);
            }
        }
    });

    return categories;
}

function buildAttendance(categories) {
    const allPages = [];
    categories.forEach(cat => cat.pages.forEach(p => allPages.push(p)));
    const totalLessons = allPages.length;

    const students = GROUP_ROSTER.map(r => ({
        name: r.full,
        short: r.short,
        attended: 0,
        percent: 0,
        missed: 0,
        lessons: []
    }));

    allPages.forEach(page => {
        (page.students || []).forEach(shortName => {
            const key = shortName.toLowerCase();
            let entry = students.find(s => s.short.toLowerCase() === key || s.name.toLowerCase() === key);
            if (!entry) {
                // Если в конспекте указано имя вне списка группы — добавляем динамически
                entry = { name: shortName, short: shortName, attended: 0, percent: 0, missed: 0, lessons: [] };
                students.push(entry);
            }
            entry.attended += 1;
            entry.lessons.push({ date: page.date, title: page.title, category: page.category });
        });
    });

    students.forEach(s => {
        s.missed = Math.max(0, totalLessons - s.attended);
        s.percent = totalLessons > 0 ? Math.round((s.attended / totalLessons) * 100) : 0;
    });

    return { totalLessons, students };
}

function build() {
    console.log('🔨 Начинаю сборку сайта...');

    const categories = readDocsDir(DOCS_DIR);

    if (!fs.existsSync(TEMPLATE_PATH)) {
        console.error('❌ Ошибка: template.html не найден!');
        process.exit(1);
    }

    const template = fs.readFileSync(TEMPLATE_PATH, 'utf-8');

    const attendanceObj = buildAttendance(categories);

    const siteDataJSON = JSON.stringify({ categories }, null, 2);
    const attendanceJSON = JSON.stringify(attendanceObj, null, 2);

    // Заменяем плейсхолдеры на реальные данные
    let html = template.replace(
        'window.siteData = {"categories":[]};',
        `window.siteData = ${siteDataJSON};`
    );
    html = html.replace(
        'window.attendanceData = {"students":[],"totalLessons":0};',
        `window.attendanceData = ${attendanceJSON};`
    );

    const outputPath = path.join(OUTPUT_DIR, 'index.html');
    fs.writeFileSync(outputPath, html);

    // Отдельный файл со статистикой (страница сначала пробует взять данные из него)
    const attendancePath = path.join(OUTPUT_DIR, 'attendance.json');
    fs.writeFileSync(attendancePath, attendanceJSON);

    const totalPages = categories.reduce((sum, cat) => sum + cat.pages.length, 0);

    console.log(`✅ Сайт собран!`);
    console.log(`   Категорий: ${categories.length}`);
    console.log(`   Страниц: ${totalPages}`);
    console.log(`   Студентов в группе: ${attendanceObj.students.length}`);
    console.log(`   Файл: ${outputPath}`);
    console.log(`   Статистика: ${attendancePath}`);
}

build();
