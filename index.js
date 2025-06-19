import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import {create} from 'xmlbuilder2';
import {XMLParser} from 'fast-xml-parser';
import fs from 'fs/promises';
import {executablePath} from "puppeteer";

const puppeteerStealth = StealthPlugin();
puppeteerStealth.enabledEvasions.delete('user-agent-override');
puppeteer.use(puppeteerStealth);

const xmlPath = 'docs/index.xml';
const URL = 'https://apkpure.com/android-device-policy/com.google.android.apps.work.clouddpc/versions';

(async () => {
    console.log('🛫 - Launching browser...');

    const browser = await puppeteer.launch({
        executablePath: executablePath(),
        readTimeout: 5 * 60 * 1000,
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-notifications',
            '--disable-dev-shm-usage',
        ],
    });
    console.log('🤖 - Browser launched');

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36')

    try {
        console.log('🌐 - Loading page...');
        await page.goto(URL, {waitUntil: 'domcontentloaded'});

        console.log('✔️ - Page loaded');

        await page.waitForFunction(() => {
            return !document.querySelector('form#challenge-form, .cf-browser-verification') &&
                !/Attention Required/.test(document.title);
        }, {timeout: 20000}).catch(() => {
            throw new Error('⛔ - Cloudflare challenge did not resolve in time');
        });

        const versions = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('li a.ver_download_link'))
                .map(link => {
                    const version = link.querySelector('.ver-item-n')?.textContent
                        ?.trim()
                        ?.replace(/^Android Device Policy\s*/i, '')
                        ?.replace(/\s+/g, ' ');

                    const date = link.querySelector('.update-on')?.textContent.trim();
                    const href = link.getAttribute('href');

                    return version && date && href
                        ? {version, date, link: href.startsWith('http') ? href : `https://apkpure.com${href}`}
                        : null;
                })
                .filter(Boolean);
        });

        if (!versions || versions.length === 0) {
            console.warn('⚠️ - No versions scraped — dumping page content for debugging');

            const html = await page.content();
            await fs.mkdir('docs', {recursive: true});
            await fs.writeFile('debug.html', html);
            await page.screenshot({path: 'debug.png', fullPage: true});

            console.log('📝 - Saved debug.html and screenshot.png to docs/');
            return;
        }

        if (versions.length) console.log(`🦝 - Scraped ${versions.length} versions`);

        await browser.close();

        let existingItems = [];

        if ((await fs.stat(xmlPath)).isFile()) {
            const xmlData = await fs.readFile(xmlPath, 'utf-8');
            const parser = new XMLParser();
            const parsed = parser.parse(xmlData);
            const items = parsed?.rss?.channel?.item || [];
            existingItems = Array.isArray(items) ? items : [items];
        }

        // Use a Set for fast version-date matching
        const existingKeys = new Set(existingItems.map(i => `${i.guid}`));

        // Add only new entries
        const newItems = versions
            .filter(v => !existingKeys.has(v.version))
            .map(v => {
                const pubDate = new Date().toUTCString();
                const guid = v.version;
                return {
                    title: `Android Device Policy ${v.version} - ${v.date}`,
                    link: v.link,
                    description: `Version ${v.version} released on ${v.date}`,
                    pubDate,
                    guid
                };
            })

        console.log(`🔎 - Found ${newItems.length} new versions`);
        
        if(newItems.length === 0){
            return
        }

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
        
        console.log(`📝 - Saving xml feed...`)
        const xml = create({version: '1.0', encoding: 'UTF-8'}, rss).end({prettyPrint: true});
        await fs.writeFile(xmlPath, xml);
        console.log(`💾 - Saving done`)
    } catch (err) {
        console.error('💥 Scraper failed:', err);

        const errorHtml = await page.content();
        await page.screenshot({path: 'debud.png', fullPage: true});

        await fs.mkdir('docs', {recursive: true});
        await fs.writeFile('debug.html', errorHtml);

        console.log('📝 - Saved debug.html and debug.png to docs/');
    } finally {
        await browser.close();
    }
})();
