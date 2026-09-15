const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { marked } = require('marked');

const DOCS_DIR = path.join(__dirname, '..', 'docs');
const OUTPUT_DIR = path.join(__dirname, '..', 'dist');
const TEMPLATE_PATH = path.join(__dirname, '..', 'template.html');

if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
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
            files.sort();
            
            files.forEach(file => {
                const filePath = path.join(fullPath, file);
                const content = fs.readFileSync(filePath, 'utf-8');
                const { data, content: markdown } = matter(content);
                
                const titleMatch = markdown.match(/^#\s+(.+)$/m);
                const title = titleMatch ? titleMatch[1].trim() : file.replace('.md', '');
                
                const htmlContent = marked(markdown);
                
                const toc = [];
                const headingRegex = /^(#{2,3})\s+(.+)$/gm;
                let match;
                
                while ((match = headingRegex.exec(markdown)) !== null) {
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
                    category: category.id,
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

function build() {
    console.log('🔨 Начинаю сборку сайта...');
    
    const categories = readDocsDir(DOCS_DIR);
    
    if (!fs.existsSync(TEMPLATE_PATH)) {
        console.error('❌ Ошибка: template.html не найден!');
        process.exit(1);
    }
    
    const template = fs.readFileSync(TEMPLATE_PATH, 'utf-8');
    
    const siteDataObj = { categories };
    const siteDataJSON = JSON.stringify(siteDataObj, null, 2);
    
    // Заменяем плейсхолдер на реальные данные
    let html = template.replace(
        'window.siteData = {"categories":[]};',
        `window.siteData = ${siteDataJSON};`
    );
    
    const outputPath = path.join(OUTPUT_DIR, 'index.html');
    fs.writeFileSync(outputPath, html);
    
    const totalPages = categories.reduce((sum, cat) => sum + cat.pages.length, 0);
    
    console.log(`✅ Сайт собран!`);
    console.log(`   Категорий: ${categories.length}`);
    console.log(`   Страниц: ${totalPages}`);
    console.log(`   Файл: ${outputPath}`);
}

build();
