import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import {create} from 'xmlbuilder2';
import {XMLParser} from 'fast-xml-parser';
import fs from 'fs';

puppeteer.use(StealthPlugin());

const URL = 'https://apkpure.com/android-device-policy/com.google.android.apps.work.clouddpc/versions';

(async () => {
    console.log('Launching browser...');
    const browser = await puppeteer.launch({headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox']});
    console.log('Browser launched');

    let versions = [];
    let page

    try {
        page = await browser.newPage();
        await page.goto(URL, { waitUntil: 'networkidle2' });
        console.log('✅ Page loaded');

        versions = await page.evaluate(() => {
            const items = document.querySelectorAll('li a.ver_download_link');
            const result = [];

            items.forEach(link => {
                const versionDiv = link.querySelector('.ver-item-n');
                const dateSpan = link.querySelector('.update-on');

                const version = versionDiv ? versionDiv.textContent.trim().replace(/\s+/g, ' ') : null;
                const date = dateSpan ? dateSpan.textContent.trim() : null;
                const href = link.getAttribute('href');

                if (version && date && href) {
                    result.push({
                        version,
                        date,
                        link: href.startsWith('http') ? href : `https://apkpure.com${href}`
                    });
                }
            });

            return result;
        });

        if (!versions || versions.length === 0) {
            console.warn('⚠️ No versions scraped — dumping page content for debugging');

            const fs = await import('fs/promises');
            const html = await page.content();
            await fs.mkdir('docs', { recursive: true });
            await fs.writeFile('debug.html', html);
            await page.screenshot({ path: 'screenshot.png', fullPage: true });

            console.log('📝 Saved debug.html and screenshot.png to docs/');
        }
        
        if (versions.length) console.log(`✅ Scraped ${versions.length} versions`);
    } catch (e) {
        console.error('❌ Page load failed:', e);
        const errorHtml = await page.content();
        await page.screenshot({ path: 'screenshot.png', fullPage: true });

        const fs = await import('fs/promises');
        await fs.mkdir('docs', { recursive: true });
        await fs.writeFile('docs/debug.html', errorHtml);

        console.log('📝 Saved debug.html and screenshot.png to docs/');
    }

    await browser.close();
    
    //console.log(versions);

    let existingItems = [];

    if (fs.existsSync('index.xml')) {
        const xmlData = fs.readFileSync('index.xml', 'utf-8');
        const parser = new XMLParser();
        const parsed = parser.parse(xmlData);
        const items = parsed?.rss?.channel?.item || [];
        existingItems = Array.isArray(items) ? items : [items];
    }

    // Use a Set for fast version-date matching
    const existingKeys = new Set(
        existingItems.map(i => `${i.title}`)
    );

    // Add only new entries
    const newItems = versions
        .map(v => ({
            title: `${v.version} - ${v.date}`,
            link: v.link,
            description: `Version ${v.version} released on ${v.date}`
        }))
        .filter(item => !existingKeys.has(item.title));

    // Combine and sort
    const allItems = [...newItems, ...existingItems].slice(0, 50); // keep only latest 50

    const rss = {
        rss: {
            '@version': '2.0',
            channel: {
                title: 'Android Device Policy Versions',
                link: 'https://apkpure.com/android-device-policy/com.google.android.apps.work.clouddpc/versions',
                description: 'Tracks version updates on APKPure',
                item: allItems
            }
        }
    };

    const xml = create({version: '1.0', encoding: 'UTF-8'}, rss).end({prettyPrint: true});
    fs.writeFileSync('index.xml', xml);
})();
